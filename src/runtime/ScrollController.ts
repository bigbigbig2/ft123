import { ScrollInput } from './scroll/ScrollInput';
import { ScrollTimeline } from './scroll/ScrollTimeline';
import { SnapController } from './scroll/SnapController';
import { clamp } from './scroll/math';

export interface ScrollSnapshot {
  progress: number;
  velocity: number;
}

export interface ScrollControllerOptions {
  sectionCount?: number;
  snap?: boolean;
  snapIdleDelay?: number;
  snapDuration?: number;
  velocityScale?: number;
  displayDamping?: number;
  velocityDamping?: number;
  wheelMultiplier?: number;
}

export class ScrollController {
  readonly input: ScrollInput;
  readonly timeline: ScrollTimeline;
  readonly snap: SnapController;

  progress = 0;
  rawProgress = 0;
  velocity = 0;

  private lastRafTime = 0;
  private sectionCount: number;

  constructor(opts: ScrollControllerOptions = {}) {
    this.sectionCount = Math.max(2, opts.sectionCount ?? 4);

    this.input = new ScrollInput({
      wheelMultiplier: opts.wheelMultiplier ?? 0.82,
    });
    this.timeline = new ScrollTimeline({
      damping: opts.displayDamping ?? 14,
      velocityDamping: opts.velocityDamping ?? 11,
      velocityScale: opts.velocityScale ?? 1,
    });
    this.snap = new SnapController({
      enabled: opts.snap ?? true,
      idleDelay: opts.snapIdleDelay ?? 420,
      duration: opts.snapDuration ?? 0.86,
      snapPoints: this.createUniformSnapPoints(this.sectionCount),
    });
  }

  get lenis() {
    return this.input.lenis;
  }

  raf(time: number) {
    const delta = this.lastRafTime > 0 ? (time - this.lastRafTime) / 1000 : 1 / 60;
    this.lastRafTime = time;

    this.input.raf(time, delta);
    this.timeline.update(this.input.rawProgress, delta);
    this.snap.update(time, this.input, this.timeline);

    this.rawProgress = this.input.rawProgress;
    this.progress = this.timeline.displayProgress;
    this.velocity = this.timeline.displayVelocity;
  }

  scrollToProgress(progress: number, opts: { duration?: number; immediate?: boolean } = {}) {
    const next = clamp(progress);
    this.input.scrollToProgress(next, opts);
    if (opts.immediate) {
      this.timeline.jumpTo(next);
      this.rawProgress = next;
      this.progress = next;
      this.velocity = 0;
    }
  }

  getLimit() {
    return this.input.getLimit();
  }

  setSectionCount(sectionCount: number) {
    this.sectionCount = Math.max(2, sectionCount);
    this.snap.setSnapPoints(this.createUniformSnapPoints(this.sectionCount));
  }

  setSnapPoints(points: number[]) {
    this.snap.setSnapPoints(points);
  }

  getDebugParams() {
    return {
      rawProgress: this.rawProgress,
      progress: this.progress,
      velocity: this.velocity,
      wheelInputScale: this.input.wheelInputScale,
      ...this.timeline.getDebugParams(),
      ...this.snap.getDebugParams(),
    };
  }

  applyDebugParams(params: Partial<ReturnType<ScrollController['getDebugParams']>>) {
    if (typeof params.wheelInputScale === 'number') this.input.wheelInputScale = params.wheelInputScale;
    this.timeline.applyDebugParams(params);
    this.snap.applyDebugParams(params);
  }

  destroy() {
    this.input.destroy();
  }

  private createUniformSnapPoints(sectionCount: number) {
    const segments = Math.max(sectionCount - 1, 1);
    return Array.from({ length: sectionCount }, (_item, index) => index / segments);
  }
}
