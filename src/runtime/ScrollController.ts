/**
 * ScrollController.ts — 滚动控制器
 *
 * 基于 Lenis 平滑滚动库，将原生页面滚动转换为归一化的进度值（0→1）。
 * 提供阻尼速度、空闲吸附（snap）和带微过冲的动画吸附效果。
 */
import Lenis from 'lenis';

/** 滚动状态快照 */
export interface ScrollSnapshot {
  progress: number;  // 归一化进度 0..1
  velocity: number;  // 阻尼速度 0..1
}

/** ScrollController 构造选项 */
export interface ScrollControllerOptions {
  velocityScale?: number;    // 速度缩放系数
  sectionCount?: number;     // 场景/分区数量
  snap?: boolean;            // 是否启用吸附
  snapIdleDelay?: number;    // 停止滚动后多久开始吸附（ms）
  snapDuration?: number;     // 吸附动画总时长（秒）
}

/** 将值限制在 [min, max] 范围内 */
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 指数阻尼插值（帧率无关） */
function damp(current: number, target: number, lambda: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

/** 三次缓出缓动函数 */
function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

/** 指数缓出缓动函数 */
function easeOutExpo(value: number) {
  return Math.min(1, 1.001 - Math.pow(2, -10 * value));
}

/**
 * ScrollController — 滚动控制器
 *
 * 包装 Lenis 库，实现：
 * - 压缩滚轮输入（防止不同设备/浏览器的滚动幅度差异过大）
 * - 阻尼速度（velocity）用于驱动着色器动效
 * - 空闲后自动吸附到最近的分区，并带有微过冲效果
 */
export class ScrollController {
  readonly lenis: Lenis;

  /** 归一化滚动进度（0 = 页首，1 = 页尾） */
  progress = 0;
  /** 阻尼后的滚动速度（0..1），用于驱动转场着色器 */
  velocity = 0;

  private readonly velocityScale: number;
  private readonly sectionCount: number;
  private readonly snapEnabled: boolean;
  private readonly snapIdleDelay: number;   // 空闲判定延迟（ms）
  private readonly snapDuration: number;    // 吸附总时长（秒）

  private lastProgress = 0;
  private lastRafTime = 0;
  private lastInputTime = performance.now();
  private lastSnapTime = 0;
  /** 是否正在执行吸附动画 */
  private isSnapping = false;

  constructor(opts: ScrollControllerOptions = {}) {
    this.velocityScale = opts.velocityScale ?? 1;
    this.sectionCount = Math.max(2, opts.sectionCount ?? 4);
    this.snapEnabled = opts.snap ?? true;
    this.snapIdleDelay = opts.snapIdleDelay ?? 260;
    this.snapDuration = opts.snapDuration ?? 1.05;

    // ── 初始化 Lenis 平滑滚动 ─────────────────────────────────
    this.lenis = new Lenis({
      duration: 1.28,
      easing: easeOutExpo,
      lerp: 0.085,
      wheelMultiplier: 1,
      touchMultiplier: 1.15,
      smoothWheel: true,
      syncTouch: true,
      syncTouchLerp: 0.08,
      touchInertiaExponent: 1.65,
      overscroll: false,
      // 虚拟滚动拦截：压缩滚轮输入到合理范围
      virtualScroll: (data) => {
        if (data.event instanceof WheelEvent) {
          // 处理不同 deltaMode（像素 / 行 / 页）的归一化
          const modeFactor =
            data.event.deltaMode === 1
              ? 16                       // LINE 模式
              : data.event.deltaMode === 2
                ? window.innerHeight     // PAGE 模式
                : 1;                     // PIXEL 模式
          // 将 deltaY 限制到 [-72, 72]，避免过大跳跃
          const normalizedDelta = clamp(data.event.deltaY * modeFactor, -72, 72);

          // 转换为 Lenis 可消费的像素量
          data.deltaY = normalizedDelta * 2.35;
        }

        this.markInput();
        return true;
      },
    });

    // 监听 Lenis 滚动事件，将像素位置转为归一化进度
    this.lenis.on('scroll', ({ scroll, limit }: { scroll: number; limit: number }) => {
      this.progress = limit > 0 ? clamp(scroll / limit, 0, 1) : 0;
    });
  }

  /**
   * 每帧调用（由 Engine.onTick 驱动）
   * @param time - performance.now() 时间戳
   */
  raf(time: number) {
    const delta = this.lastRafTime > 0 ? (time - this.lastRafTime) / 1000 : 1 / 60;
    this.lastRafTime = time;

    this.lenis.raf(time);         // 驱动 Lenis 内部动画
    this.updateVelocity(delta);   // 更新阻尼速度
    this.maybeSnap(time);         // 检查是否需要吸附
  }

  /**
   * 平滑滚动到指定进度
   * @param progress - 目标归一化进度 0..1
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

  /** 获取 Lenis 的 scroll limit（最大滚动量，像素） */
  getLimit() {
    return (this.lenis as unknown as { limit: number }).limit ?? 0;
  }

  /** 销毁 Lenis 实例 */
  destroy() {
    this.lenis.destroy();
  }

  /** 标记用户有新输入，重置吸附计时器 */
  private markInput() {
    this.lastInputTime = performance.now();
    this.isSnapping = false;
  }

  /**
   * 计算阻尼速度
   * 将帧间进度差映射到 0..1，再做指数阻尼平滑
   */
  private updateVelocity(delta: number) {
    const frameVelocity = clamp(
      Math.abs(this.progress - this.lastProgress) * 18 * this.velocityScale,
      0,
      1,
    );
    this.velocity = damp(this.velocity, frameVelocity, 6.4, delta);
    if (this.velocity < 0.001) this.velocity = 0;
    this.lastProgress = this.progress;
  }

  /**
   * 空闲吸附检测
   * 当用户停止滚动且速度足够低时，自动吸附到最近的分区
   */
  private maybeSnap(time: number) {
    if (!this.snapEnabled || this.isSnapping) return;

    const limit = this.getLimit();
    if (limit <= 0) return;
    // 条件：空闲时间超过阈值、距上次吸附足够久、速度足够低
    if (time - this.lastInputTime < this.snapIdleDelay) return;
    if (time - this.lastSnapTime < 520) return;
    if (this.velocity > 0.012) return;

    const targetProgress = this.getNearestSectionProgress();
    // 距离目标太近则不吸附
    if (Math.abs(targetProgress - this.progress) < 0.012) return;

    this.lastSnapTime = time;
    this.snapToProgress(targetProgress);
  }

  /** 获取距当前进度最近的分区的归一化进度值 */
  private getNearestSectionProgress() {
    const segments = this.sectionCount - 1;
    return Math.round(this.progress * segments) / segments;
  }

  /**
   * 两阶段吸附动画：
   * 第一阶段 —— 先过冲（overshoot）到目标的稍远处（72% 时长）
   * 第二阶段 —— 再回弹到精确目标位置（28% 时长）
   * 产生类似弹簧的微妙过冲手感
   */
  private snapToProgress(targetProgress: number) {
    const limit = this.getLimit();
    const start = this.progress * limit;
    const final = clamp(targetProgress, 0, 1) * limit;
    const distance = final - start;

    if (Math.abs(distance) < 1) return;

    this.isSnapping = true;

    // 计算过冲量：最大不超过总行程的 7%
    const overshootDistance = Math.min(Math.abs(distance) * 0.22, limit * 0.07);
    const overshoot = clamp(final + Math.sign(distance) * overshootDistance, 0, limit);
    const phaseOneDuration = this.snapDuration * 0.72;  // 过冲阶段时长
    const phaseTwoDuration = this.snapDuration * 0.28;  // 回弹阶段时长

    // 第一阶段：滚动到过冲位置
    this.lenis.scrollTo(overshoot, {
      duration: phaseOneDuration,
      easing: easeOutCubic,
      lock: false,
      onComplete: () => {
        // 第二阶段：回弹到精确目标
        this.lenis.scrollTo(final, {
          duration: phaseTwoDuration,
          easing: easeOutCubic,
          lock: false,
          onComplete: () => {
            this.isSnapping = false;
            this.progress = targetProgress;
            this.lastProgress = targetProgress;
          },
        });
      },
    });
  }
}
