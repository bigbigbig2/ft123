import type {
  SceneBase,
  SceneScrollState,
  SceneTransitionDirection,
  SceneTransitionState,
} from '../scenes/SceneBase';
import { clamp, smoothstep } from './math';
import type { ChapterLayout } from './chapterConfig';

export interface SceneFrameState {
  globalProgress: number;
  /** 当前场景内部进度，范围 0..1。 */
  sceneProgress: number;
  /** 作为 next 场景进入画面的进度。 */
  enter: number;
  /** 作为 current 场景离开画面的进度。 */
  leave: number;
  /** 场景当前的视觉主导权，通常用于透明度、文案、细节显隐。 */
  focus: number;
  velocity: number;
  direction: SceneTransitionDirection;
}

export interface TimelineFrame {
  globalProgress: number;
  velocity: number;
  direction: SceneTransitionDirection;
  activeChapter: ChapterLayout;
  nextChapter: ChapterLayout | null;
  current: SceneBase;
  next: SceneBase;
  mix: number;
  localProgress: number;
  sceneStates: Map<string, SceneFrameState>;
}

export interface TimelineDirectorOptions {
  inactiveLeave?: number;
}

/**
 * 滚动时间线导演。
 *
 * 它只做路由和状态分发：根据全局 progress 计算当前章节、下个章节、
 * from/to 场景和 mix。场景内部动画不在这里写。
 */
export class TimelineDirector {
  private scenes: SceneBase[];
  private sceneMap: Map<string, SceneBase>;
  private chapters: ChapterLayout[];
  private lastProgress = 0;
  private lastActiveSet = new Set<SceneBase>();
  private inactiveLeave: number;

  constructor(scenes: SceneBase[], chapters: ChapterLayout[], opts: TimelineDirectorOptions = {}) {
    if (scenes.length < 2) throw new Error('TimelineDirector requires at least 2 scenes.');
    if (chapters.length < 2) throw new Error('TimelineDirector requires at least 2 chapters.');

    this.scenes = scenes;
    this.sceneMap = new Map(scenes.map((scene) => [scene.name, scene]));
    this.chapters = chapters;
    this.inactiveLeave = opts.inactiveLeave ?? 1;

    for (const chapter of chapters) {
      if (!this.sceneMap.has(chapter.sceneName)) {
        throw new Error(`Chapter "${chapter.id}" references missing scene "${chapter.sceneName}".`);
      }
    }
  }

  update(globalProgress: number, velocity = 0): TimelineFrame {
    const progress = clamp(globalProgress);
    const direction = this.getDirection(progress);
    const activeChapter = this.getActiveChapter(progress);
    const nextChapter = this.chapters[activeChapter.index + 1] ?? null;
    const localProgress = this.getLocalProgress(progress, activeChapter);
    // mix 是当前章节转到下一章节的唯一混合值，渲染合成和场景 enter/leave 都基于它。
    const mix = nextChapter
      ? smoothstep(activeChapter.transitionStart, activeChapter.transitionEnd, localProgress)
      : 0;

    const current = this.getScene(activeChapter.sceneName);
    const next = nextChapter ? this.getScene(nextChapter.sceneName) : current;
    const sceneStates = this.createSceneStates(
      progress,
      activeChapter,
      nextChapter,
      localProgress,
      mix,
      velocity,
      direction,
    );

    this.syncActiveScenes(current, next, activeChapter, localProgress, mix, velocity, direction);
    this.syncSceneState(current, next, activeChapter, localProgress, mix, velocity, direction);

    this.lastProgress = progress;

    return {
      globalProgress: progress,
      velocity,
      direction,
      activeChapter,
      nextChapter,
      current,
      next,
      mix,
      localProgress,
      sceneStates,
    };
  }

  getChapters() {
    return this.chapters.slice();
  }

  getSnapPoints() {
    // 章节起点就是吸附落点，保证用户停下时画面处于稳定章节状态。
    const points = this.chapters.map((chapter) => chapter.start);
    points.push(1);
    return Array.from(new Set(points.map((point) => Number(point.toFixed(5))))).sort((a, b) => a - b);
  }

  private getScene(sceneName: string) {
    const scene = this.sceneMap.get(sceneName);
    if (!scene) throw new Error(`Missing scene "${sceneName}".`);
    return scene;
  }

  private getActiveChapter(progress: number) {
    // 从后往前查找，能自然处理 progress 正好落在章节边界上的情况。
    for (let index = this.chapters.length - 1; index >= 0; index -= 1) {
      if (progress >= this.chapters[index]!.start) return this.chapters[index]!;
    }
    return this.chapters[0]!;
  }

  private getLocalProgress(progress: number, chapter: ChapterLayout) {
    return clamp((progress - chapter.start) / Math.max(chapter.end - chapter.start, 0.0001));
  }

  private getDirection(progress: number): SceneTransitionDirection {
    const delta = progress - this.lastProgress;
    if (Math.abs(delta) < 0.00001) return 0;
    return delta > 0 ? 1 : -1;
  }

  private createSceneStates(
    globalProgress: number,
    activeChapter: ChapterLayout,
    nextChapter: ChapterLayout | null,
    localProgress: number,
    mix: number,
    velocity: number,
    direction: SceneTransitionDirection,
  ) {
    const states = new Map<string, SceneFrameState>();

    // current 场景逐渐 leave/focus 降低；next 场景逐渐 enter/focus 提高。
    states.set(activeChapter.sceneName, {
      globalProgress,
      sceneProgress: localProgress,
      enter: 1,
      leave: mix,
      focus: 1 - mix,
      velocity,
      direction,
    });

    if (nextChapter) {
      states.set(nextChapter.sceneName, {
        globalProgress,
        sceneProgress: 0,
        enter: mix,
        leave: 0,
        focus: mix,
        velocity,
        direction,
      });
    }

    return states;
  }

  private syncActiveScenes(
    current: SceneBase,
    next: SceneBase,
    activeChapter: ChapterLayout,
    localProgress: number,
    mix: number,
    velocity: number,
    direction: SceneTransitionDirection,
  ) {
    // 提前激活 next 场景，但只有 current/next 会参与 update/render，避免所有场景同时跑。
    const preloadStart = activeChapter.transitionStart - (activeChapter.preloadMargin ?? 0.1);
    const shouldPreloadNext = next !== current && localProgress >= preloadStart;
    const nextActiveSet = new Set<SceneBase>([current]);

    if (next !== current && (mix > 0 || shouldPreloadNext)) {
      nextActiveSet.add(next);
    }

    for (const scene of this.lastActiveSet) {
      if (!nextActiveSet.has(scene)) {
        scene.setActive(false);
        scene.setScrollState(this.createScrollState('inactive', scene, 0, 0, 0, this.inactiveLeave, velocity, direction));
      }
    }

    for (const scene of nextActiveSet) {
      if (!this.lastActiveSet.has(scene)) scene.setActive(true);
    }

    this.lastActiveSet = nextActiveSet;
  }

  private syncSceneState(
    current: SceneBase,
    next: SceneBase,
    activeChapter: ChapterLayout,
    localProgress: number,
    mix: number,
    velocity: number,
    direction: SceneTransitionDirection,
  ) {
    // 兼容现有 SceneBase 接口：同时发送简化 transitionState 和更完整 scrollState。
    current.setProgress(localProgress);
    current.setTransitionState(this.createTransitionState('current', localProgress, mix, direction, activeChapter.index));
    current.setScrollState(
      this.createScrollState('current', current, localProgress, 1 - mix, 1, mix, velocity, direction),
    );

    if (next !== current) {
      next.setProgress(0);
      next.setTransitionState(this.createTransitionState('next', 0, mix, direction, activeChapter.index));
      next.setScrollState(
        this.createScrollState('next', next, 0, mix, mix, 0, velocity, direction),
      );
    }
  }

  private createTransitionState(
    role: SceneTransitionState['role'],
    localProgress: number,
    blend: number,
    direction: SceneTransitionDirection,
    currentIndex: number,
  ): SceneTransitionState {
    return {
      role,
      localProgress,
      blend,
      direction,
      currentIndex,
    };
  }

  private createScrollState(
    role: SceneScrollState['role'],
    scene: SceneBase,
    local: number,
    focus: number,
    enter: number,
    leave: number,
    velocity: number,
    direction: SceneTransitionDirection,
  ): SceneScrollState {
    return {
      role,
      sceneIndex: Math.max(0, this.scenes.indexOf(scene)),
      local: clamp(local),
      focus: clamp(focus),
      enter: clamp(enter),
      leave: clamp(leave),
      velocity: clamp(velocity),
      direction,
    };
  }
}
