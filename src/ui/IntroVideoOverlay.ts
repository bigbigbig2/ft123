import type { VideoScene } from '../scenes/VideoScene';
import { damp } from '../scroll/math';

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export class IntroVideoOverlay {
  private progress = 0;

  constructor(
    private readonly element: HTMLElement | null,
    private readonly videoScene: VideoScene,
  ) {}

  update(delta: number) {
    if (!this.element) return;

    const status = this.videoScene.getVideoDebugData().status;
    const isMainRevealSegment = status.currentIndex >= 3 && status.currentIndex < 5;
    const isReverse3Segment = status.currentSegment.includes('reverse3ToLoop2');
    const target = (isMainRevealSegment || isReverse3Segment) && !status.finished ? 1 : 0;
    this.progress = damp(this.progress, target, target > this.progress ? 5.5 : 8, delta);

    if (this.progress < 0.001) this.progress = 0;
    const visible = clamp01(this.progress);
    this.element.style.setProperty('--intro-video-overlay-progress', visible.toFixed(3));
    this.element.classList.toggle('is-visible', target > 0.5);
    this.element.setAttribute('aria-hidden', visible > 0.02 ? 'false' : 'true');
  }
}
