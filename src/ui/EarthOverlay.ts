import type { SceneFrameState } from '../scroll/TimelineDirector';

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.min(1, Math.max(0, (value - edge0) / Math.max(edge1 - edge0, 0.0001)));
  return x * x * (3 - 2 * x);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/**
 * 地球章节的 DOM 层控制器。
 *
 * WebGL 负责地球本体，页面上的标题、轨道线、说明文字由 CSS 变量驱动。
 * 这里把 TimelineDirector 派发的场景状态映射成这些 CSS 变量。
 */
export class EarthOverlay {
  constructor(private readonly element: HTMLElement | null) {}

  update(state?: SceneFrameState) {
    if (!this.element) return;

    const focus = clamp01(state?.focus ?? 0);
    const local = clamp01(state?.sceneProgress ?? 0);
    // 各元素错峰出现，让地球先成为视觉主体，再露出文案和装饰线。
    const heading = focus * smoothstep(0.46, 0.7, local);
    const frame = focus * smoothstep(0.36, 0.66, local);
    const copy = focus * smoothstep(0.64, 0.88, local);

    this.element.style.setProperty('--earth-overlay-opacity', focus.toFixed(3));
    this.element.style.setProperty('--earth-brand-opacity', focus.toFixed(3));
    this.element.style.setProperty('--earth-heading-opacity', heading.toFixed(3));
    this.element.style.setProperty('--earth-frame-opacity', frame.toFixed(3));
    this.element.style.setProperty('--earth-copy-opacity', copy.toFixed(3));
  }
}

/** 转场合成 shader 使用的地球雾化强度，和 overlay 共享同一份场景状态。 */
export function getEarthMistStrength(state?: SceneFrameState) {
  const focus = clamp01(state?.focus ?? 0);
  const local = clamp01(state?.sceneProgress ?? 0);
  const nearMist = 1 - smoothstep(0.06, 0.58, local);
  return focus * (0.5 + nearMist * 0.34);
}
