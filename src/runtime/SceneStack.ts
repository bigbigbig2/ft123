import type {
  SceneBase,
  SceneScrollState,
  SceneTransitionDirection,
  SceneTransitionState,
} from '../scenes/SceneBase';
import { clamp, smoothstep } from './scroll/math';

export interface SyncResult {
  current: SceneBase;
  next: SceneBase;
  localProgress: number;
  blend: number;
  currentIndex: number;
  direction: SceneTransitionDirection;
}

export interface SceneStackOptions {
  transitionStart?: number;
  transitionEnd?: number;
  preloadMargin?: number;
  boundaryHysteresis?: number;
  segmentTransitions?: Record<number, Partial<SceneStackTransition>>;
}

interface SceneStackTransition {
  transitionStart: number;
  transitionEnd: number;
  preloadMargin: number;
}

export class SceneStack {
  private scenes: SceneBase[];
  private transitionStart: number;
  private transitionEnd: number;
  private preloadMargin: number;
  private segmentTransitions: Record<number, Partial<SceneStackTransition>>;
  private boundaryHysteresis: number;
  private lastActiveSet = new Set<SceneBase>();
  private lastProgress = 0;
  private activeSegmentIndex = 0;

  constructor(scenes: SceneBase[], options: SceneStackOptions = {}) {
    if (scenes.length < 2) {
      throw new Error('SceneStack requires at least 2 scenes.');
    }

    this.scenes = scenes;
    this.transitionStart = options.transitionStart ?? 0.52;
    this.transitionEnd = options.transitionEnd ?? 0.84;
    this.preloadMargin = options.preloadMargin ?? 0.14;
    this.segmentTransitions = options.segmentTransitions ?? {};
    this.boundaryHysteresis = options.boundaryHysteresis ?? 0.016;
  }

  /**
   * 同步滚动进度，执行切片与场景分发（每帧调用）
   * @param globalProgress 全局原生进度 (0~1)
   * @param velocity 物理平滑速度，将一并打包发送给各场景
   */
  sync(globalProgress: number, velocity = 0): SyncResult {
    const progress = clamp(globalProgress);
    const direction = this.getDirection(progress);
    const segments = this.segmentCount;

    // 1. 判断当前处在哪个段落内 (含抗抖动迟滞判断)
    this.updateActiveSegment(progress, direction);

    const currentIndex = Math.min(this.activeSegmentIndex, segments - 1);
    
    // 2. 剥离出当前段落内的局部进度 (0~1)
    const localProgress = this.getLocalProgress(progress, currentIndex);
    
    // 3. 计算特效所需的融合系数 (受 transitionStart 和 End 阈值影响)
    const transition = this.getTransition(currentIndex);
    const blend = this.getBlend(localProgress, transition);
    
    // 4. 定位新旧场景
    const current = this.scenes[currentIndex]!;
    const next = this.scenes[currentIndex + 1] ?? current;

    // 5. 按需激活与剔除 (Culling优化)
    this.syncActiveScenes(current, next, localProgress, blend, transition, direction, velocity);
    
    // 6. 广播计算好的各个维度进度给场景
    this.syncSceneState(current, next, localProgress, blend, direction, currentIndex, velocity);

    this.lastProgress = progress;

    return { current, next, localProgress, blend, currentIndex, direction };
  }

  get length() {
    return this.scenes.length;
  }

  get segmentCount() {
    return Math.max(this.scenes.length - 1, 1);
  }

  getScenes() {
    return this.scenes.slice();
  }

  getSnapPoints() {
    const segments = this.segmentCount;
    return this.scenes.map((_scene, index) => index / segments);
  }

  getDebugParams() {
    return {
      transitionStart: this.transitionStart,
      transitionEnd: this.transitionEnd,
      preloadMargin: this.preloadMargin,
      boundaryHysteresis: this.boundaryHysteresis,
    };
  }

  applyDebugParams(params: Partial<ReturnType<SceneStack['getDebugParams']>>) {
    if (typeof params.transitionStart === 'number') this.transitionStart = clamp(params.transitionStart, 0, 0.98);
    if (typeof params.transitionEnd === 'number') this.transitionEnd = clamp(params.transitionEnd, 0.02, 1);
    if (typeof params.preloadMargin === 'number') this.preloadMargin = clamp(params.preloadMargin, 0, 0.5);
    if (typeof params.boundaryHysteresis === 'number') {
      this.boundaryHysteresis = clamp(params.boundaryHysteresis, 0, 0.08);
    }

    if (this.transitionEnd <= this.transitionStart + 0.01) {
      this.transitionEnd = Math.min(1, this.transitionStart + 0.01);
    }
  }

  private updateActiveSegment(progress: number, direction: SceneTransitionDirection) {
    const segments = this.segmentCount;
    const rawIndex = Math.min(Math.floor(progress * segments), segments - 1);

    if (Math.abs(progress - this.lastProgress) < 0.00001) {
      this.activeSegmentIndex = clamp(this.activeSegmentIndex, 0, segments - 1);
      return;
    }

    if (this.activeSegmentIndex < 0 || this.activeSegmentIndex >= segments) {
      this.activeSegmentIndex = rawIndex;
      return;
    }

    const hysteresis = this.boundaryHysteresis / segments;
    const lowerBoundary = this.activeSegmentIndex / segments;
    const upperBoundary = (this.activeSegmentIndex + 1) / segments;

    if (direction > 0 && this.activeSegmentIndex < segments - 1 && progress > upperBoundary + hysteresis) {
      this.activeSegmentIndex += 1;
      return;
    }

    if (direction < 0 && this.activeSegmentIndex > 0 && progress < lowerBoundary - hysteresis) {
      this.activeSegmentIndex -= 1;
      return;
    }

    if (Math.abs(rawIndex - this.activeSegmentIndex) > 1) {
      this.activeSegmentIndex = rawIndex;
    }
  }

  private getLocalProgress(progress: number, currentIndex: number) {
    const segmentStart = currentIndex / this.segmentCount;
    const segmentEnd = (currentIndex + 1) / this.segmentCount;
    return clamp((progress - segmentStart) / Math.max(segmentEnd - segmentStart, 0.0001));
  }

  private getTransition(currentIndex: number): SceneStackTransition {
    const segment = this.segmentTransitions[currentIndex] ?? {};
    const transitionStart = segment.transitionStart ?? this.transitionStart;
    let transitionEnd = segment.transitionEnd ?? this.transitionEnd;
    const preloadMargin = segment.preloadMargin ?? this.preloadMargin;

    if (transitionEnd <= transitionStart + 0.01) {
      transitionEnd = Math.min(1, transitionStart + 0.01);
    }

    return {
      transitionStart: clamp(transitionStart, 0, 0.98),
      transitionEnd: clamp(transitionEnd, 0.02, 1),
      preloadMargin: clamp(preloadMargin, 0, 0.5),
    };
  }

  private getBlend(localProgress: number, transition: SceneStackTransition) {
    return smoothstep(transition.transitionStart, transition.transitionEnd, localProgress);
  }

  private getDirection(progress: number): SceneTransitionDirection {
    const delta = progress - this.lastProgress;
    if (Math.abs(delta) < 0.00001) return 0;
    return delta > 0 ? 1 : -1;
  }

  private syncActiveScenes(
    current: SceneBase,
    next: SceneBase,
    localProgress: number,
    blend: number,
    transition: SceneStackTransition,
    direction: SceneTransitionDirection,
    velocity: number,
  ) {
    const shouldPreloadNext = localProgress >= transition.transitionStart - transition.preloadMargin;
    const nextActiveSet = new Set<SceneBase>([current]);

    if (next !== current && (blend > 0 || shouldPreloadNext)) {
      nextActiveSet.add(next);
    }

    for (const scene of this.lastActiveSet) {
      if (!nextActiveSet.has(scene)) {
        scene.setActive(false);
        scene.setScrollState(this.createScrollState('inactive', this.scenes.indexOf(scene), 0, 0, 0, 1, velocity, direction));
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
    localProgress: number,
    blend: number,
    direction: SceneTransitionDirection,
    currentIndex: number,
    velocity: number,
  ) {
    current.setProgress(localProgress);
    current.setTransitionState(this.createState('current', localProgress, blend, direction, currentIndex));
    current.setScrollState(
      this.createScrollState('current', currentIndex, localProgress, 1 - blend, 1, blend, velocity, direction),
    );

    if (next !== current) {
      next.setProgress(0);
      next.setTransitionState(this.createState('next', 0, blend, direction, currentIndex));
      next.setScrollState(
        this.createScrollState('next', currentIndex + 1, 0, blend, blend, 0, velocity, direction),
      );
    }
  }

  private createState(
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
    sceneIndex: number,
    local: number,
    focus: number,
    enter: number,
    leave: number,
    velocity: number,
    direction: SceneTransitionDirection,
  ): SceneScrollState {
    return {
      role,
      sceneIndex: Math.max(0, sceneIndex),
      local: clamp(local),
      focus: clamp(focus),
      enter: clamp(enter),
      leave: clamp(leave),
      velocity: clamp(velocity),
      direction,
    };
  }
}
