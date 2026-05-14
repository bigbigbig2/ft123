import { clamp } from './math';
import type { ScrollInput } from './ScrollInput';
import type { ScrollTimeline } from './ScrollTimeline';

export interface SnapControllerOptions {
  enabled?: boolean;
  idleDelay?: number;
  duration?: number;
  velocityThreshold?: number;
  distanceThreshold?: number;
  cooldown?: number;
  snapPoints?: number[];
}

export class SnapController {
  enabled: boolean;
  idleDelay: number;
  duration: number;
  velocityThreshold: number;
  distanceThreshold: number;

  private cooldown: number;
  private snapPoints: number[];
  private isSnapping = false;
  private lastSnapTime = 0;
  private snapTarget: number | null = null;

  constructor(opts: SnapControllerOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.idleDelay = opts.idleDelay ?? 420;
    this.duration = opts.duration ?? 0.86;
    this.velocityThreshold = opts.velocityThreshold ?? 0.018;
    this.distanceThreshold = opts.distanceThreshold ?? 0.01;
    this.cooldown = opts.cooldown ?? 520;
    this.snapPoints = opts.snapPoints ?? [0, 1];
  }

  setSnapPoints(points: number[]) {
    const normalized = points
      .map((point) => clamp(point))
      .sort((a, b) => a - b)
      .filter((point, index, array) => index === 0 || Math.abs(point - array[index - 1]!) > 0.0001);
    this.snapPoints = normalized.length > 0 ? normalized : [0, 1];
  }

  update(time: number, input: ScrollInput, timeline: ScrollTimeline) {
    if (!this.enabled || input.getLimit() <= 0) {
      this.isSnapping = false;
      this.snapTarget = null;
      return;
    }

    const idleFor = time - input.getLastInputTime();
    if (idleFor < this.idleDelay) {
      this.isSnapping = false;
      this.snapTarget = null;
      return;
    }

    if (time - this.lastSnapTime < this.cooldown) return;
    if (timeline.displayVelocity > this.velocityThreshold) return;

    const target = this.getNearestSnapPoint(timeline.displayProgress);
    if (Math.abs(target - timeline.displayProgress) < this.distanceThreshold) return;
    if (this.isSnapping && this.snapTarget !== null && Math.abs(this.snapTarget - target) < 0.0001) return;

    this.isSnapping = true;
    this.snapTarget = target;
    this.lastSnapTime = time;
    input.scrollToProgress(target, { duration: this.duration });
  }

  getNearestSnapPoint(progress: number) {
    let nearest = this.snapPoints[0] ?? 0;
    let nearestDistance = Math.abs(progress - nearest);

    for (const point of this.snapPoints) {
      const distance = Math.abs(progress - point);
      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  getDebugParams() {
    return {
      snapEnabled: this.enabled,
      snapIdleDelay: this.idleDelay,
      snapDuration: this.duration,
      snapVelocityThreshold: this.velocityThreshold,
      snapDistanceThreshold: this.distanceThreshold,
    };
  }

  applyDebugParams(params: Partial<ReturnType<SnapController['getDebugParams']>>) {
    if (typeof params.snapEnabled === 'boolean') this.enabled = params.snapEnabled;
    if (typeof params.snapIdleDelay === 'number') this.idleDelay = params.snapIdleDelay;
    if (typeof params.snapDuration === 'number') this.duration = params.snapDuration;
    if (typeof params.snapVelocityThreshold === 'number') this.velocityThreshold = params.snapVelocityThreshold;
    if (typeof params.snapDistanceThreshold === 'number') this.distanceThreshold = params.snapDistanceThreshold;
  }
}
