import { clamp, damp } from './math';

export interface ScrollTimelineOptions {
  damping?: number;
  velocityDamping?: number;
  velocityScale?: number;
}

export class ScrollTimeline {
  rawProgress = 0;
  displayProgress = 0;
  displayVelocity = 0;

  private lastDisplayProgress = 0;
  private damping: number;
  private velocityDamping: number;
  private velocityScale: number;

  constructor(opts: ScrollTimelineOptions = {}) {
    this.damping = opts.damping ?? 14;
    this.velocityDamping = opts.velocityDamping ?? 11;
    this.velocityScale = opts.velocityScale ?? 1;
  }

  update(rawProgress: number, delta: number) {
    this.rawProgress = clamp(rawProgress);
    this.displayProgress = damp(this.displayProgress, this.rawProgress, this.damping, delta);

    const frameVelocity = clamp(
      Math.abs(this.displayProgress - this.lastDisplayProgress) / Math.max(delta, 0.0001) / 3.0 * this.velocityScale,
    );
    this.displayVelocity = damp(this.displayVelocity, frameVelocity, this.velocityDamping, delta);
    if (this.displayVelocity < 0.001) this.displayVelocity = 0;

    this.lastDisplayProgress = this.displayProgress;
  }

  jumpTo(progress: number) {
    const next = clamp(progress);
    this.rawProgress = next;
    this.displayProgress = next;
    this.lastDisplayProgress = next;
    this.displayVelocity = 0;
  }

  getDebugParams() {
    return {
      displayDamping: this.damping,
      velocityDamping: this.velocityDamping,
      velocityScale: this.velocityScale,
    };
  }

  applyDebugParams(params: Partial<ReturnType<ScrollTimeline['getDebugParams']>>) {
    if (typeof params.displayDamping === 'number') this.damping = params.displayDamping;
    if (typeof params.velocityDamping === 'number') this.velocityDamping = params.velocityDamping;
    if (typeof params.velocityScale === 'number') this.velocityScale = params.velocityScale;
  }
}
