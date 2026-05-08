/**
 * SceneStack.ts — 场景栈管理器
 *
 * 根据全局滚动进度（0→1）决定当前显示的场景对（current / next），
 * 计算过渡混合系数（blend），并管理场景的激活/停用生命周期。
 */
import type {
  SceneBase,
  SceneTransitionDirection,
  SceneTransitionState,
} from '../scenes/SceneBase';

/** sync() 的返回值，描述当前帧的场景状态 */
export interface SyncResult {
  current: SceneBase;                    // 当前主场景
  next: SceneBase;                       // 下一个场景（过渡目标）
  localProgress: number;                 // 当前段内的局部进度 0..1
  blend: number;                         // 过渡混合系数 0..1
  currentIndex: number;                  // 当前段索引
  direction: SceneTransitionDirection;   // 滚动方向（-1 / 0 / 1）
}

/** SceneStack 构造选项 */
export interface SceneStackOptions {
  /** 局部进度达到多少时开始过渡（默认 0.7） */
  transitionStart?: number;
  /** 在过渡开始前多少距离就预加载下一个场景（默认 0.08） */
  preloadMargin?: number;
}

/**
 * SceneStack — 场景栈
 *
 * 将全局滚动进度均等分配给 N-1 个"段"，每段对应两个相邻场景之间的过渡。
 * 在每段的前 transitionStart 范围内只显示当前场景，
 * 之后开始向下一场景过渡。
 */
export class SceneStack {
  private scenes: SceneBase[];
  /** 局部进度到达该值后才开始过渡 */
  private transitionStart: number;
  /** 预加载裕量（在过渡开始前提前激活下一场景） */
  private preloadMargin: number;
  /** 上一帧处于激活状态的场景集合 */
  private lastActiveSet = new Set<SceneBase>();
  /** 上一次的全局进度值，用于计算滚动方向 */
  private lastProgress = 0;

  constructor(scenes: SceneBase[], options: SceneStackOptions = {}) {
    if (scenes.length < 2) {
      throw new Error('SceneStack requires at least 2 scenes.');
    }

    this.scenes = scenes;
    this.transitionStart = options.transitionStart ?? 0.7;
    this.preloadMargin = options.preloadMargin ?? 0.08;
  }

  /**
   * 核心同步方法 — 每帧由渲染循环调用
   *
   * @param globalProgress - 全局滚动进度 0..1
   * @returns 当前帧的场景同步结果
   */
  sync(globalProgress: number): SyncResult {
    const segments = this.scenes.length - 1;     // 总段数
    const clamped = Math.min(1, Math.max(0, globalProgress));
    const direction = this.getDirection(clamped); // 滚动方向
    const scaled = clamped * segments;            // 映射到段索引空间
    const currentIndex = Math.min(Math.floor(scaled), segments - 1);
    const localProgress = scaled - currentIndex;  // 段内局部进度

    const current = this.scenes[currentIndex]!;
    const next = this.scenes[currentIndex + 1] ?? current;
    const blend = this.getBlend(localProgress);   // 过渡混合系数

    // 管理场景激活/停用
    this.syncActiveScenes(current, next, localProgress, blend);
    // 同步场景的进度和过渡状态
    this.syncSceneState(current, next, localProgress, blend, direction, currentIndex);

    this.lastProgress = clamped;

    return { current, next, localProgress, blend, currentIndex, direction };
  }

  /** 场景总数 */
  get length() {
    return this.scenes.length;
  }

  /** 获取场景列表的浅拷贝 */
  getScenes() {
    return this.scenes.slice();
  }

  /**
   * 将局部进度映射为混合系数
   * 在 transitionStart 之前返回 0，之后线性增长到 1
   */
  private getBlend(localProgress: number) {
    if (localProgress < this.transitionStart) return 0;
    return (localProgress - this.transitionStart) / Math.max(1 - this.transitionStart, 0.0001);
  }

  /** 根据进度差值判断滚动方向 */
  private getDirection(progress: number): SceneTransitionDirection {
    const delta = progress - this.lastProgress;
    if (Math.abs(delta) < 0.00001) return 0;
    return delta > 0 ? 1 : -1;
  }

  /**
   * 管理场景的激活/停用
   * 只有当前场景和即将进入过渡的下一场景保持激活，
   * 其余场景被停用以节省资源。
   */
  private syncActiveScenes(
    current: SceneBase,
    next: SceneBase,
    localProgress: number,
    blend: number,
  ) {
    // 判断是否应该预加载下一场景
    const shouldPreloadNext = localProgress >= this.transitionStart - this.preloadMargin;
    const nextActiveSet = new Set<SceneBase>([current]);
    if (next !== current && (blend > 0 || shouldPreloadNext)) {
      nextActiveSet.add(next);
    }

    // 停用上一帧激活但本帧不再需要的场景
    for (const scene of this.lastActiveSet) {
      if (!nextActiveSet.has(scene)) scene.setActive(false);
    }

    // 激活本帧新增的场景
    for (const scene of nextActiveSet) {
      if (!this.lastActiveSet.has(scene)) scene.setActive(true);
    }

    this.lastActiveSet = nextActiveSet;
  }

  /** 将进度和过渡状态同步到当前场景和下一场景 */
  private syncSceneState(
    current: SceneBase,
    next: SceneBase,
    localProgress: number,
    blend: number,
    direction: SceneTransitionDirection,
    currentIndex: number,
  ) {
    current.setProgress(localProgress);
    current.setTransitionState(this.createState('current', localProgress, blend, direction, currentIndex));

    if (next !== current) {
      next.setProgress(0);
      next.setTransitionState(this.createState('next', 0, blend, direction, currentIndex));
    }
  }

  /** 构造 SceneTransitionState 对象 */
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
}
