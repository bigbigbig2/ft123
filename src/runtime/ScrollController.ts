import Lenis from 'lenis';

/**
 * 滚动快照接口
 * 用于记录某一时刻的滚动状态
 */
export interface ScrollSnapshot {
  progress: number; // 归一化进度 (0 到 1)
  velocity: number; // 滚动速度 (归一化后的相对值)
}

/**
 * 滚动控制器构造选项
 */
export interface ScrollControllerOptions {
  velocityScale?: number;  // 速度缩放系数
  sectionCount?: number;   // 页面分段总数（用于吸附计算）
  snap?: boolean;          // 是否启用自动吸附
  snapIdleDelay?: number;  // 停止操作后触发吸附的延迟时间 (ms)
  snapDuration?: number;   // 吸附动画的时长 (s)
}

/**
 * 工具函数：限制数值范围
 */
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 指数平滑函数 (Damping)
 * 用于平滑地从当前值过渡到目标值，具有帧率无关性
 * @param lambda 强度系数
 */
function damp(current: number, target: number, lambda: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

/**
 * 三次方输出缓动函数
 */
function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

/**
 * 指数级输出缓动函数 (Lenis 默认风格)
 */
function easeOutExpo(value: number) {
  return Math.min(1, 1.001 - Math.pow(2, -10 * value));
}

/**
 * ScrollController - 滚动控制器类
 * 
 * 职责：
 * 1. 封装 Lenis 滚动引擎，提供平滑滚动体验。
 * 2. 将绝对滚动距离映射为 0 到 1 的归一化进度。
 * 3. 实时计算滚动速度，供着色器和动效使用。
 * 4. 实现基于分段的自动吸附逻辑 (Snap to Section)。
 */
export class ScrollController {
  readonly lenis: Lenis;

  progress = 0; // 当前滚动进度 (0..1)
  velocity = 0; // 当前平滑后的滚动速度

  // ── 配置参数 ──────────────────────────────────────────────────────
  private velocityScale: number;      // 速度缩放
  private readonly sectionCount: number; // 分段数量
  private snapEnabled: boolean;       // 是否启用吸附
  private snapIdleDelay: number;      // 吸附前的静止等待时间
  private snapDuration: number;       // 吸附动画时长
  
  // ── 内部调优常数 (微调物理感) ─────────────────────────────────────
  private wheelInputScale = 0.5;       // 鼠标滚动输入倍率
  private velocityDamping = 10;        // 速度平滑的阻尼强度
  private snapVelocityThreshold = 0.012; // 触发吸附的速度上限（速度必须足够低才触发）
  private snapDistanceThreshold = 0.012; // 触发吸附的最小距离（太近则不吸附）
  private overshootScale = 0.22;       // 吸附回弹的比例（产生超过目标再回弹的效果）
  private overshootMaxRatio = 0.07;    // 最大回弹位移限制

  // ── 状态追踪 ──────────────────────────────────────────────────────
  private lastProgress = 0;
  private lastRafTime = 0;
  private lastInputTime = performance.now();
  private lastSnapTime = 0;
  private isSnapping = false;

  constructor(opts: ScrollControllerOptions = {}) {
    this.velocityScale = opts.velocityScale ?? 1;
    this.sectionCount = Math.max(2, opts.sectionCount ?? 4);
    this.snapEnabled = opts.snap ?? true;
    this.snapIdleDelay = opts.snapIdleDelay ?? 1000;
    this.snapDuration = opts.snapDuration ?? 1.08;

    // 初始化 Lenis 滚动引擎
    this.lenis = new Lenis({
      duration: 1.28,         // 滚动动画时长
      easing: easeOutExpo,    // 缓动曲线
      lerp: 0.085,            // 插值强度（针对某些模式）
      wheelMultiplier: 1,     // 滚轮倍率
      touchMultiplier: 1.15,  // 触摸倍率
      smoothWheel: true,      // 启用平滑鼠标滚动
      syncTouch: true,        // 同步触摸滚动
      syncTouchLerp: 0.08,    // 触摸滚动插值
      touchInertiaExponent: 1.65, // 触摸惯性指数
      overscroll: false,      // 禁用溢出滚动
      
      /**
       * 虚拟滚动钩子
       * 拦截原始事件，进行自定义的输入处理
       */
      virtualScroll: (data) => {
        if (data.event instanceof WheelEvent) {
          // 处理 Windows/Chrome 下 deltaMode 为行或页的情况
          const modeFactor =
            data.event.deltaMode === 1
              ? 16
              : data.event.deltaMode === 2
                ? window.innerHeight
                : 1;
          
          // 限制单词输入的位移大小，防止超大步进
          const normalizedDelta = clamp(data.event.deltaY * modeFactor, -72, 72);
          data.deltaY = normalizedDelta * this.wheelInputScale;
        }

        this.markInput(); // 标记有用户输入
        return true;
      },
    });

    // 监听滚动事件，实时更新归一化进度
    this.lenis.on('scroll', ({ scroll, limit }: { scroll: number; limit: number }) => {
      this.progress = limit > 0 ? clamp(scroll / limit, 0, 1) : 0;
    });
  }

  /**
   * 每一帧的渲染驱动更新
   * @param time 当前运行总时间 (ms)
   */
  raf(time: number) {
    const delta = this.lastRafTime > 0 ? (time - this.lastRafTime) / 1000 : 1 / 60;
    this.lastRafTime = time;

    this.lenis.raf(time);       // 更新 Lenis 状态
    this.updateVelocity(delta); // 计算当前平滑速度
    this.maybeSnap(time);       // 检查并处理自动吸附
  }

  /**
   * 滚动到指定的归一化进度 (0..1)
   */
  scrollToProgress(progress: number, opts: { duration?: number; immediate?: boolean } = {}) {
    const limit = this.getLimit();
    const target = clamp(progress, 0, 1) * limit;
    this.lenis.scrollTo(target, {
      duration: opts.duration ?? this.snapDuration,
      easing: easeOutExpo,
      immediate: opts.immediate,
    });
  }

  /**
   * 获取当前滚动的最大距离极限
   */
  getLimit() {
    return (this.lenis as unknown as { limit: number }).limit ?? 0;
  }

  /**
   * 获取调试参数
   * 用于 GUI 工具实时查看和修改内部状态
   */
  getDebugParams() {
    return {
      progress: this.progress,
      velocity: this.velocity,
      snapEnabled: this.snapEnabled,
      snapIdleDelay: this.snapIdleDelay,
      snapDuration: this.snapDuration,
      wheelInputScale: this.wheelInputScale,
      velocityScale: this.velocityScale,
      velocityDamping: this.velocityDamping,
      snapVelocityThreshold: this.snapVelocityThreshold,
      snapDistanceThreshold: this.snapDistanceThreshold,
      overshootScale: this.overshootScale,
      overshootMaxRatio: this.overshootMaxRatio,
    };
  }

  /**
   * 应用调试参数
   */
  applyDebugParams(params: Partial<ReturnType<ScrollController['getDebugParams']>>) {
    if (typeof params.snapEnabled === 'boolean') this.snapEnabled = params.snapEnabled;
    if (typeof params.snapIdleDelay === 'number') this.snapIdleDelay = params.snapIdleDelay;
    if (typeof params.snapDuration === 'number') this.snapDuration = params.snapDuration;
    if (typeof params.wheelInputScale === 'number') this.wheelInputScale = params.wheelInputScale;
    if (typeof params.velocityScale === 'number') this.velocityScale = params.velocityScale;
    if (typeof params.velocityDamping === 'number') this.velocityDamping = params.velocityDamping;
    if (typeof params.snapVelocityThreshold === 'number') {
      this.snapVelocityThreshold = params.snapVelocityThreshold;
    }
    if (typeof params.snapDistanceThreshold === 'number') {
      this.snapDistanceThreshold = params.snapDistanceThreshold;
    }
    if (typeof params.overshootScale === 'number') this.overshootScale = params.overshootScale;
    if (typeof params.overshootMaxRatio === 'number') this.overshootMaxRatio = params.overshootMaxRatio;
  }

  /**
   * 销毁控制器，释放 Lenis 实例
   */
  destroy() {
    this.lenis.destroy();
  }

  /**
   * 记录用户输入发生的时间
   */
  private markInput() {
    this.lastInputTime = performance.now();
    this.isSnapping = false;
  }

  /**
   * 计算平滑速度
   * 通过对比前后帧的进度差值，并经过阻尼函数平滑处理
   */
  private updateVelocity(delta: number) {
    const frameVelocity = clamp(
      Math.abs(this.progress - this.lastProgress) * 18 * this.velocityScale,
      0,
      1,
    );
    this.velocity = damp(this.velocity, frameVelocity, this.velocityDamping, delta);
    
    // 忽略极小的速度波动
    if (this.velocity < 0.001) this.velocity = 0;
    this.lastProgress = this.progress;
  }

  /**
   * 检查是否应该触发自动吸附
   * 触发条件：
   * 1. 吸附功能开启。
   * 2. 当前没在进行吸附。
   * 3. 页面有滚动空间。
   * 4. 距离最后一次用户输入已超过 Idle 延迟。
   * 5. 距离上一次吸附完成已有一定间隔。
   * 6. 速度已降低到阈值以下（即用户操作已趋于静止）。
   */
  private maybeSnap(time: number) {
    if (!this.snapEnabled || this.isSnapping) return;

    const limit = this.getLimit();
    if (limit <= 0) return;
    if (time - this.lastInputTime < this.snapIdleDelay) return;
    if (time - this.lastSnapTime < 520) return;
    if (this.velocity > this.snapVelocityThreshold) return;

    const targetProgress = this.getNearestSectionProgress();
    // 如果已经在目标附近，则无需再次吸附
    if (Math.abs(targetProgress - this.progress) < this.snapDistanceThreshold) return;

    this.lastSnapTime = time;
    this.snapToProgress(targetProgress);
  }

  /**
   * 计算离当前滚动位置最近的分段进度
   */
  private getNearestSectionProgress() {
    const segments = this.sectionCount - 1;
    return Math.round(this.progress * segments) / segments;
  }

  /**
   * 执行吸附动画
   * 使用两阶段滚动（Overshoot + Settle）实现带有物理感的回弹效果
   * 这种效果在高级网站中非常常见，让过渡显得更生动而不死板。
   */
  private snapToProgress(targetProgress: number) {
    const limit = this.getLimit();
    const start = this.progress * limit;
    const final = clamp(targetProgress, 0, 1) * limit;
    const distance = final - start;

    // 距离太短则忽略
    if (Math.abs(distance) < 1) return;

    this.isSnapping = true;

    // 计算回弹量：位移越大，回弹感越强，但受最大比例限制
    const overshootDistance = Math.min(
      Math.abs(distance) * this.overshootScale,
      limit * this.overshootMaxRatio,
    );
    
    // 目标点之后的“溢出点”
    const overshoot = clamp(final + Math.sign(distance) * overshootDistance, 0, limit);
    
    // 分配两个阶段的时间
    const phaseOneDuration = this.snapDuration * 0.72; // 第一阶段：快速冲向溢出点
    const phaseTwoDuration = this.snapDuration * 0.28; // 第二阶段：柔和回弹到最终目标

    this.lenis.scrollTo(overshoot, {
      duration: phaseOneDuration,
      easing: easeOutCubic,
      lock: false,
      onComplete: () => {
        // 第一阶段结束，开始回弹
        this.lenis.scrollTo(final, {
          duration: phaseTwoDuration,
          easing: easeOutCubic,
          lock: false,
          onComplete: () => {
            // 吸附流程全部结束
            this.isSnapping = false;
            this.progress = targetProgress;
            this.lastProgress = targetProgress;
          },
        });
      },
    });
  }
}
