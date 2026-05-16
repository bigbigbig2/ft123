import type {
  SceneBase,
  SceneScrollState,
  SceneTransitionDirection,
  SceneTransitionState,
} from '../scenes/SceneBase';
import { clamp, smoothstep } from './math';
import {
  getSceneSegments,
  getTimelineSnapPoints,
  isSceneSegment,
  isTransitionSegment,
  type TimelineSceneSegmentLayout,
  type TimelineSegmentLayout,
  type TimelineTransitionSegmentLayout,
} from './timelineConfig';

/**
 * 单个场景在某一帧的完整状态。
 * 这里同时保留 sceneProgress 和 transitionProgress，避免再把两种概念混在一个 localProgress 里。
 */
export interface SceneFrameState {
  globalProgress: number; // 全局进度 (0..1)
  segmentType: TimelineSegmentLayout['type']; // 当前处于场景段还是转场段
  segmentProgress: number; // 当前时间轴段内部进度 (0..1)
  sceneProgress: number; // 场景自己的内容进度 (0..1)
  transitionProgress: number; // A -> B 转场进度 (0..1)，非转场段为 0
  enter: number; // 进场进度 (0..1)
  leave: number; // 出场进度 (0..1)
  focus: number; // 视觉主导权 (0..1)
  velocity: number; // 瞬时滚动速度
  direction: SceneTransitionDirection; // 滚动方向
}

/** 时间线系统输出的帧数据快照。 */
export interface TimelineFrame {
  globalProgress: number;
  velocity: number;
  direction: SceneTransitionDirection;
  activeSegment: TimelineSegmentLayout; // 当前时间轴段，可以是 scene 或 transition
  current: SceneBase; // 当前主场景
  next: SceneBase; // 转场期的下一场景；非转场期等于 current
  mix: number; // 两个场景之间的混合权重 (0..1)
  segmentProgress: number; // 当前段内部进度
  sceneProgress: number; // 当前场景内容进度
  transitionProgress: number; // 当前转场进度
  sceneStates: Map<string, SceneFrameState>;
}

export interface TimelineDirectorOptions {
  inactiveLeave?: number; // 场景退出激活集时给到的默认 leave 值
}

/**
 * TimelineDirector：滚动时间线的“导演”。
 *
 * 新模型中，导演只消费显式时间轴段：
 * - scene 段：推进单个场景的内容进度。
 * - transition 段：推进 from -> to 的转场进度。
 *
 * 这样转场滚动距离由 transition 段的 duration 单独决定，不再藏在某个章节的百分比里。
 */
export class TimelineDirector {
  private scenes: SceneBase[];
  private sceneMap: Map<string, SceneBase>;
  private segments: TimelineSegmentLayout[];
  private lastProgress = 0;
  private lastActiveSet = new Set<SceneBase>();
  private inactiveLeave: number;

  constructor(scenes: SceneBase[], segments: TimelineSegmentLayout[], opts: TimelineDirectorOptions = {}) {
    if (scenes.length < 2) throw new Error('TimelineDirector requires at least 2 scenes.');
    if (segments.length < 1) throw new Error('TimelineDirector requires at least 1 timeline segment.');

    this.scenes = scenes;
    this.sceneMap = new Map(scenes.map((scene) => [scene.name, scene]));
    this.segments = segments;
    this.inactiveLeave = opts.inactiveLeave ?? 1;

    // 启动时校验时间轴引用，尽早暴露配置错误。
    for (const segment of segments) {
      if (isSceneSegment(segment)) {
        this.assertScene(segment.sceneName, segment.id);
      } else {
        this.assertScene(segment.from, segment.id);
        this.assertScene(segment.to, segment.id);
      }
    }
  }

  /**
   * 核心更新方法。每帧接收 ScrollRig 的全局 progress，然后分发给场景和渲染合成层。
   */
  update(globalProgress: number, velocity = 0): TimelineFrame {
    const progress = clamp(globalProgress);
    const direction = this.getDirection(progress);
    const activeSegment = this.getActiveSegment(progress);
    const segmentProgress = this.getSegmentProgress(progress, activeSegment);
    const state = this.resolveSegment(activeSegment, segmentProgress);

    const current = this.getScene(state.currentSceneName);
    const next = this.getScene(state.nextSceneName);

    const sceneStates = this.createSceneStates(
      progress,
      activeSegment,
      segmentProgress,
      state.mix,
      velocity,
      direction,
    );

    this.syncActiveScenes(current, next, velocity, direction);
    this.syncSceneState(current, next, activeSegment, segmentProgress, state.mix, velocity, direction);

    this.lastProgress = progress;

    return {
      globalProgress: progress,
      velocity,
      direction,
      activeSegment,
      current,
      next,
      mix: state.mix,
      segmentProgress,
      sceneProgress: state.sceneProgress,
      transitionProgress: state.transitionProgress,
      sceneStates,
    };
  }

  /** 获取完整时间轴副本，供调试面板展示。 */
  getSegments() {
    return this.segments.slice();
  }

  /** 获取所有场景段，供调试面板生成场景跳转按钮。 */
  getSceneSegments() {
    return getSceneSegments(this.segments);
  }

  /** 吸附点只使用场景段起点，避免用户停在转场段中间。 */
  getSnapPoints() {
    return getTimelineSnapPoints(this.segments);
  }

  private assertScene(sceneName: string, segmentId: string) {
    if (!this.sceneMap.has(sceneName)) {
      throw new Error(`Timeline segment "${segmentId}" references missing scene "${sceneName}".`);
    }
  }

  private getScene(sceneName: string) {
    const scene = this.sceneMap.get(sceneName);
    if (!scene) throw new Error(`Missing scene "${sceneName}".`);
    return scene;
  }

  /** 根据全局进度查找当前时间轴段。 */
  private getActiveSegment(progress: number) {
    // 从后往前找，能自然处理 progress 正好落在段边界上的情况。
    for (let index = this.segments.length - 1; index >= 0; index -= 1) {
      if (progress >= this.segments[index]!.start) return this.segments[index]!;
    }
    return this.segments[0]!;
  }

  /** 将全局进度映射到当前段内部的 0..1。 */
  private getSegmentProgress(progress: number, segment: TimelineSegmentLayout) {
    return clamp((progress - segment.start) / Math.max(segment.end - segment.start, 0.0001));
  }

  /** 计算瞬时滚动方向。 */
  private getDirection(progress: number): SceneTransitionDirection {
    const delta = progress - this.lastProgress;
    if (Math.abs(delta) < 0.00001) return 0;
    return delta > 0 ? 1 : -1;
  }

  /** 根据当前段类型，解析当前场景、下一场景和混合值。 */
  private resolveSegment(segment: TimelineSegmentLayout, segmentProgress: number) {
    if (isSceneSegment(segment)) {
      return {
        currentSceneName: segment.sceneName,
        nextSceneName: segment.sceneName,
        mix: 0,
        sceneProgress: segmentProgress,
        transitionProgress: 0,
      };
    }

    const mix = segmentProgress; // 移除 smoothstep，依赖全局进度的阻尼来保证平滑，避免段与段之间的“停顿感”
    return {
      currentSceneName: segment.from,
      nextSceneName: segment.to,
      mix,
      sceneProgress: 1,
      transitionProgress: mix,
    };
  }

  /** 构建调试和 overlay 可读取的场景状态表。 */
  private createSceneStates(
    globalProgress: number,
    activeSegment: TimelineSegmentLayout,
    segmentProgress: number,
    mix: number,
    velocity: number,
    direction: SceneTransitionDirection,
  ) {
    const states = new Map<string, SceneFrameState>();

    if (isSceneSegment(activeSegment)) {
      states.set(activeSegment.sceneName, {
        globalProgress,
        segmentType: 'scene',
        segmentProgress,
        sceneProgress: segmentProgress,
        transitionProgress: 0,
        enter: 1,
        leave: 0,
        focus: 1,
        velocity,
        direction,
      });
      return states;
    }

    states.set(activeSegment.from, {
      globalProgress,
      segmentType: 'transition',
      segmentProgress,
      sceneProgress: 1,
      transitionProgress: mix,
      enter: 1,
      leave: mix,
      focus: 1 - mix,
      velocity,
      direction,
    });

    states.set(activeSegment.to, {
      globalProgress,
      segmentType: 'transition',
      segmentProgress,
      sceneProgress: 0,
      transitionProgress: mix,
      enter: mix,
      leave: 0,
      focus: mix,
      velocity,
      direction,
    });

    return states;
  }

  /** 只激活当前段真正需要的场景。 */
  private syncActiveScenes(
    current: SceneBase,
    next: SceneBase,
    velocity: number,
    direction: SceneTransitionDirection,
  ) {
    const nextActiveSet = new Set<SceneBase>([current]);
    if (next !== current) nextActiveSet.add(next);

    for (const scene of this.lastActiveSet) {
      if (!nextActiveSet.has(scene)) {
        scene.setActive(false);
        scene.setScrollState(this.createScrollState('inactive', scene, 0, 0, 0, this.inactiveLeave, 0, 0, velocity, direction));
      }
    }

    for (const scene of nextActiveSet) {
      if (!this.lastActiveSet.has(scene)) scene.setActive(true);
    }

    this.lastActiveSet = nextActiveSet;
  }

  /** 将当前段计算出的状态下发给具体场景。 */
  private syncSceneState(
    current: SceneBase,
    next: SceneBase,
    activeSegment: TimelineSegmentLayout,
    segmentProgress: number,
    mix: number,
    velocity: number,
    direction: SceneTransitionDirection,
  ) {
    if (isSceneSegment(activeSegment)) {
      this.syncSceneSegmentState(current, activeSegment, segmentProgress, velocity, direction);
      return;
    }

    this.syncTransitionSegmentState(current, next, activeSegment, segmentProgress, mix, velocity, direction);
  }

  /** scene 段：只推进当前场景自己的内容进度。 */
  private syncSceneSegmentState(
    current: SceneBase,
    activeSegment: TimelineSceneSegmentLayout,
    segmentProgress: number,
    velocity: number,
    direction: SceneTransitionDirection,
  ) {
    current.setProgress(segmentProgress);
    current.setTransitionState(this.createTransitionState('current', segmentProgress, 0, direction, activeSegment.index));
    current.setScrollState(
      this.createScrollState('current', current, segmentProgress, 1, 1, 0, segmentProgress, 0, velocity, direction),
    );
  }

  /** transition 段：只推进 from -> to 的转场，不消耗 to 场景自己的内容时间。 */
  private syncTransitionSegmentState(
    current: SceneBase,
    next: SceneBase,
    activeSegment: TimelineTransitionSegmentLayout,
    segmentProgress: number,
    mix: number,
    velocity: number,
    direction: SceneTransitionDirection,
  ) {
    current.setProgress(1);
    current.setTransitionState(this.createTransitionState('current', 1, mix, direction, activeSegment.index));
    current.setScrollState(
      this.createScrollState('current', current, 1, 1 - mix, 1, mix, segmentProgress, mix, velocity, direction),
    );

    next.setProgress(0);
    next.setTransitionState(this.createTransitionState('next', 0, mix, direction, activeSegment.index));
    next.setScrollState(
      this.createScrollState('next', next, 0, mix, mix, 0, segmentProgress, mix, velocity, direction),
    );
  }

  /** 创建转场状态包，兼容现有 SceneBase 接口。 */
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

  /** 创建详细滚动状态包。 */
  private createScrollState(
    role: SceneScrollState['role'],
    scene: SceneBase,
    local: number,
    focus: number,
    enter: number,
    leave: number,
    segmentProgress: number,
    transitionProgress: number,
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
      segmentProgress: clamp(segmentProgress),
      transitionProgress: clamp(transitionProgress),
      velocity: clamp(velocity),
      direction,
    };
  }
}
