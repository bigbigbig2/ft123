import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { clamp, easeOutExpo } from './math';

// 注册 GSAP 的 ScrollTrigger 插件，它是后续处理滚动进度的核心
gsap.registerPlugin(ScrollTrigger);

/**
 * 滚动系统输出的状态接口
 */
export interface ScrollRigState {
  progress: number;    // 全局滚动进度 (0..1)
  velocity: number;    // 归一化后的滚动速度 (0..1)，常用于控制渲染效果的强度
  rawVelocity: number; // 原始像素速度
  direction: -1 | 0 | 1; // 滚动方向：1 向下, -1 向上, 0 停止
}

/**
 * ScrollRig 初始化配置项
 */
export interface ScrollRigOptions {
  snap?: boolean;            // 是否开启滚动吸附
  snapPoints?: number[];     // 吸附落点数组 (0..1 进度)
  wheelMultiplier?: number;  // 滚轮缩放倍率
  touchMultiplier?: number;  // 触摸缩放倍率
  wheelDeltaClamp?: number;  // 限制单次滚轮事件的最大位移，防止某些鼠标一次滚动跳太远
  lenisDuration?: number;    // 惯性滚动的持续时间
}

type ScrollRigListener = (state: ScrollRigState) => void;

/**
 * ScrollRig 类：滚动系统的唯一入口。
 *
 * 核心设计理念：
 * 1. 使用 Lenis 接管原生滚动，提供流畅的惯性手感。
 * 2. 使用 GSAP ScrollTrigger 将页面真实的像素偏移映射为 0..1 的逻辑进度。
 * 3. 通过订阅模式将状态同步给渲染引擎或其他业务模块，实现“数据驱动动画”。
 */
export class ScrollRig {
  readonly lenis: Lenis;

  private trigger: ScrollTrigger | null = null;
  private ticker: (time: number) => void;
  private listeners = new Set<ScrollRigListener>();
  private wheelInputScale: number;
  private wheelDeltaClamp: number;
  private state: ScrollRigState = {
    progress: 0,
    velocity: 0,
    rawVelocity: 0,
    direction: 0,
  };

  constructor(opts: ScrollRigOptions = {}) {
    this.wheelInputScale = opts.wheelMultiplier ?? 0.12;
    this.wheelDeltaClamp = opts.wheelDeltaClamp ?? 120;

    // 初始化 Lenis 惯性滚动实例
    this.lenis = new Lenis({
      duration: opts.lenisDuration ?? 0.72,
      easing: easeOutExpo,
      wheelMultiplier: 1, // 这里的 multiplier 保持 1，我们通过 virtualScroll 手动处理缩放
      touchMultiplier: opts.touchMultiplier ?? 1.08,
      smoothWheel: true,
      syncTouch: true,
      syncTouchLerp: 0.1,
      touchInertiaExponent: 1.45,
      overscroll: false,
      virtualScroll: (data) => {
        // 核心优化：拦截原始滚动事件，统一不同设备的 deltaMode
        if (data.event instanceof WheelEvent) {
          // deltaMode 含义: 0=像素, 1=行, 2=页
          const modeFactor =
            data.event.deltaMode === 1
              ? 16
              : data.event.deltaMode === 2
                ? window.innerHeight
                : 1;

          // 先限制单次滚轮事件的最大位移，再做倍率缩放，保证不同鼠标和触控板的手感更接近。
          data.deltaY = clamp(
            data.event.deltaY * modeFactor,
            -this.wheelDeltaClamp,
            this.wheelDeltaClamp,
          ) * this.wheelInputScale;
        }

        return true;
      },
    });

    // 监听 Lenis 更新并同步给 ScrollTrigger
    this.lenis.on('scroll', () => ScrollTrigger.update());

    this.ticker = (time) => {
      this.lenis.raf(time);
    };

    // 创建一个覆盖整个页面的 ScrollTrigger 实例，作为全局进度条
    this.trigger = ScrollTrigger.create({
      start: 0,
      end: () => ScrollTrigger.maxScroll(window), // 动态获取页面最大滚动高度
      scrub: true, // 进度与滚动条绑定
      invalidateOnRefresh: true, // 页面缩放时自动重新计算
      snap: opts.snap
        ? {
            snapTo: opts.snapPoints ?? [0, 1],
            duration: { min: 0.22, max: 0.5 },
            delay: 0.08,
            ease: 'power3.out',
            directional: true,
          }
        : undefined,
      onUpdate: (self) => {
        // 当滚动发生时，计算并广播新的状态
        const rawVelocity = Math.abs(self.getVelocity());

        this.state = {
          progress: clamp(self.progress),
          rawVelocity,
          // 将原始速度归一化。3200 是一个经验阈值，超过这个速度 velocity 会趋于 1。
          // 这个值常用于 Shader 中的运动模糊 (Motion Blur) 或色彩偏移强度。
          velocity: clamp(rawVelocity / 3200),
          direction: self.direction > 0 ? 1 : self.direction < 0 ? -1 : 0,
        };
        this.notify();
      },
    });

    // 初始化时手动刷新一次，确保位置正确
    ScrollTrigger.refresh();
  }

  /**
   * 手动更新驱动：由渲染引擎 (Engine) 的 loop 调用。
   * 确保滚动计算与渲染帧完全同步。
   */
  update(time: number) {
    this.ticker(time);
  }

  /**
   * 获取当前最新的滚动状态快照
   */
  getState(): ScrollRigState {
    return { ...this.state };
  }

  /**
   * 获取调试参数（用于 GUI 面板实时调整）
   */
  getDebugParams() {
    return {
      wheelInputScale: this.wheelInputScale,
      wheelDeltaClamp: this.wheelDeltaClamp,
    };
  }

  /**
   * 应用调试参数
   */
  applyDebugParams(params: Partial<ReturnType<ScrollRig['getDebugParams']>>) {
    if (typeof params.wheelInputScale === 'number') this.wheelInputScale = params.wheelInputScale;
    if (typeof params.wheelDeltaClamp === 'number') this.wheelDeltaClamp = params.wheelDeltaClamp;
  }

  /**
   * 订阅滚动状态变化。
   * 这是一个典型的观察者模式，所有依赖滚动的组件（如场景管理器）都会调用此方法。
   */
  subscribe(listener: ScrollRigListener) {
    this.listeners.add(listener);
    // 订阅时立即执行一次回调，传递当前状态，确保 UI 状态和数据同步
    listener(this.getState());
    // 返回取消订阅的函数
    return () => this.listeners.delete(listener);
  }

  /**
   * 编程式滚动：平滑滚动到指定的 0..1 进度位置
   */
  scrollToProgress(progress: number, opts: { immediate?: boolean; duration?: number } = {}) {
    // 换算 0..1 到像素位置
    const target = clamp(progress) * ScrollTrigger.maxScroll(window);
    this.lenis.scrollTo(target, {
      immediate: opts.immediate,
      duration: opts.duration ?? 0.58,
      easing: easeOutExpo,
      lock: false,
    });
  }

  /**
   * 强制重新计算页面高度和滚动位置（通常在 DOM 内容异步变化后调用）
   */
  refresh() {
    ScrollTrigger.refresh();
  }

  /**
   * 销毁实例，清理内存和事件监听，防止内存泄漏
   */
  destroy() {
    this.trigger?.kill();
    this.trigger = null;
    gsap.ticker.remove(this.ticker);
    this.lenis.destroy();
    this.listeners.clear();
  }

  /**
   * 通知所有订阅者状态已更新
   */
  private notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
