import Lenis from 'lenis';
import { clamp, easeOutExpo } from './math';

export interface ScrollInputOptions {
  duration?: number;
  wheelMultiplier?: number;
  touchMultiplier?: number;
  wheelDeltaClamp?: number;
}

export class ScrollInput {
  readonly lenis: Lenis;

  rawProgress = 0;
  rawVelocity = 0;
  wheelInputScale: number;

  private lastRawProgress = 0;
  private lastInputTime = performance.now();
  private readonly wheelDeltaClamp: number;

  constructor(opts: ScrollInputOptions = {}) {
    this.wheelDeltaClamp = opts.wheelDeltaClamp ?? 96;
    this.wheelInputScale = opts.wheelMultiplier ?? 0.82;

    this.lenis = new Lenis({
      duration: opts.duration ?? 1.05,
      easing: easeOutExpo,
      wheelMultiplier: 1,
      touchMultiplier: opts.touchMultiplier ?? 1.1,
      smoothWheel: true,
      syncTouch: true,
      syncTouchLerp: 0.08,
      touchInertiaExponent: 1.55,
      overscroll: false,
      virtualScroll: (data) => {
        if (data.event instanceof WheelEvent) {
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

        this.markInput();
        return true;
      },
    });

    this.lenis.on('scroll', ({ scroll, limit }: { scroll: number; limit: number }) => {
      this.rawProgress = limit > 0 ? clamp(scroll / limit) : 0;
    });
  }

  raf(time: number, delta: number) {
    this.lenis.raf(time);
    this.rawVelocity = clamp(Math.abs(this.rawProgress - this.lastRawProgress) / Math.max(delta, 0.0001) / 3.2);
    this.lastRawProgress = this.rawProgress;
  }

  scrollToProgress(progress: number, opts: { duration?: number; immediate?: boolean } = {}) {
    const limit = this.getLimit();
    this.lenis.scrollTo(clamp(progress) * limit, {
      duration: opts.duration ?? 0.86,
      easing: easeOutExpo,
      immediate: opts.immediate,
      lock: false,
    });
  }

  getLimit() {
    return (this.lenis as unknown as { limit: number }).limit ?? 0;
  }

  getLastInputTime() {
    return this.lastInputTime;
  }

  markInput() {
    this.lastInputTime = performance.now();
  }

  destroy() {
    this.lenis.destroy();
  }
}
