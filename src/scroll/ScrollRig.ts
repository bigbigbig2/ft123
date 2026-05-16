import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { clamp, easeOutExpo } from './math';

gsap.registerPlugin(ScrollTrigger);

export interface ScrollRigState {
  progress: number;
  velocity: number;
  rawVelocity: number;
  direction: -1 | 0 | 1;
}

export interface ScrollRigOptions {
  snap?: boolean;
  snapPoints?: number[];
  wheelMultiplier?: number;
  touchMultiplier?: number;
  wheelDeltaClamp?: number;
  lenisDuration?: number;
}

type ScrollRigListener = (state: ScrollRigState) => void;

/**
 * 滚动输入的唯一入口。
 *
 * Lenis 负责滚动手感，ScrollTrigger 负责把页面滚动位置转换成稳定的
 * 0..1 全局进度。其他模块不要直接读取 window.scrollY。
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
    this.wheelInputScale = opts.wheelMultiplier ?? 0.95;
    this.wheelDeltaClamp = opts.wheelDeltaClamp ?? 180;

    this.lenis = new Lenis({
      duration: opts.lenisDuration ?? 0.72,
      easing: easeOutExpo,
      wheelMultiplier: 1,
      touchMultiplier: opts.touchMultiplier ?? 1.08,
      smoothWheel: true,
      syncTouch: true,
      syncTouchLerp: 0.1,
      touchInertiaExponent: 1.45,
      overscroll: false,
      virtualScroll: (data) => {
        if (data.event instanceof WheelEvent) {
          // 不同设备的 deltaMode 不一致，这里先统一成像素再做裁剪。
          const modeFactor =
            data.event.deltaMode === 1
              ? 16
              : data.event.deltaMode === 2
                ? window.innerHeight
                : 1;

          data.deltaY = clamp(
            data.event.deltaY * modeFactor,
            -this.wheelDeltaClamp,
            this.wheelDeltaClamp,
          ) * this.wheelInputScale;
        }

        return true;
      },
    });

    // Lenis 改变滚动位置后，主动通知 ScrollTrigger 重新计算 progress。
    this.lenis.on('scroll', () => ScrollTrigger.update());

    // 用 GSAP ticker 驱动 Lenis，避免额外开一套 requestAnimationFrame。
    this.ticker = (time) => {
      this.lenis.raf(time * 1000);
    };
    gsap.ticker.add(this.ticker);
    gsap.ticker.lagSmoothing(0);

    this.trigger = ScrollTrigger.create({
      start: 0,
      end: () => ScrollTrigger.maxScroll(window),
      scrub: true,
      invalidateOnRefresh: true,
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
        const rawVelocity = Math.abs(self.getVelocity());
        // velocity 归一化后传给 shader，用来控制拖影、雾化等速度相关效果。
        this.state = {
          progress: clamp(self.progress),
          rawVelocity,
          velocity: clamp(rawVelocity / 3200),
          direction: self.direction > 0 ? 1 : self.direction < 0 ? -1 : 0,
        };
        this.notify();
      },
    });

    ScrollTrigger.refresh();
  }

  getState(): ScrollRigState {
    return { ...this.state };
  }

  getDebugParams() {
    return {
      wheelInputScale: this.wheelInputScale,
      wheelDeltaClamp: this.wheelDeltaClamp,
    };
  }

  applyDebugParams(params: Partial<ReturnType<ScrollRig['getDebugParams']>>) {
    if (typeof params.wheelInputScale === 'number') this.wheelInputScale = params.wheelInputScale;
    if (typeof params.wheelDeltaClamp === 'number') this.wheelDeltaClamp = params.wheelDeltaClamp;
  }

  subscribe(listener: ScrollRigListener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  scrollToProgress(progress: number, opts: { immediate?: boolean; duration?: number } = {}) {
    // 对外只暴露 0..1 进度，内部再换算成实际滚动像素位置。
    const target = clamp(progress) * ScrollTrigger.maxScroll(window);
    this.lenis.scrollTo(target, {
      immediate: opts.immediate,
      duration: opts.duration ?? 0.58,
      easing: easeOutExpo,
      lock: false,
    });
  }

  refresh() {
    ScrollTrigger.refresh();
  }

  destroy() {
    this.trigger?.kill();
    this.trigger = null;
    gsap.ticker.remove(this.ticker);
    this.lenis.destroy();
    this.listeners.clear();
  }

  private notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
