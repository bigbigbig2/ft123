import type { SceneFrameState, TimelineFrame } from '../scroll/TimelineDirector';

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.min(1, Math.max(0, (value - edge0) / Math.max(edge1 - edge0, 0.0001)));
  return x * x * (3 - 2 * x);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

interface EarthOverlayOptions {
  brandStartProgress?: number;
}

interface TextLine {
  chars: HTMLElement[];
}

/**
 * 地球章节的 DOM 层控制器。
 *
 * WebGL 负责地球本体，页面上的标题、轨道线、说明文字由 CSS 变量驱动。
 * 这里把 TimelineDirector 派发的场景状态映射成这些 CSS 变量。
 */
export class EarthOverlay {
  private readonly brandStartProgress: number;
  private readonly titleLine: TextLine | null;
  private readonly phaseLine: TextLine | null;
  private readonly copyLines: TextLine[];

  constructor(
    private readonly element: HTMLElement | null,
    opts: EarthOverlayOptions = {},
  ) {
    this.brandStartProgress = opts.brandStartProgress ?? 0;
    this.titleLine = this.prepareTextLine('.earth-overlay__title');
    this.phaseLine = this.prepareTextLine('.earth-overlay__phase');
    this.copyLines = this.prepareTextLines('.earth-overlay__copy p');
  }

  update(state?: SceneFrameState, frame?: TimelineFrame) {
    if (!this.element) return;

    const focus = clamp01(state?.focus ?? 0);
    const local = clamp01(state?.sceneProgress ?? 0);
    const global = clamp01(frame?.globalProgress ?? 0);
    const brand = smoothstep(this.brandStartProgress, this.brandStartProgress + 0.035, global);
    // 各元素错峰出现，让地球先成为视觉主体，再露出文案和装饰线。
    const heading = focus * smoothstep(0.46, 0.7, local);
    const frameOpacity = focus * smoothstep(0.36, 0.66, local);
    const copy = focus * smoothstep(0.64, 0.88, local);

    this.element.style.setProperty('--earth-overlay-opacity', Math.max(focus, brand).toFixed(3));
    this.element.style.setProperty('--earth-brand-opacity', brand.toFixed(3));
    this.element.style.setProperty('--earth-heading-opacity', heading.toFixed(3));
    this.element.style.setProperty('--earth-frame-opacity', frameOpacity.toFixed(3));
    this.element.style.setProperty('--earth-copy-opacity', copy.toFixed(3));
    this.revealLine(this.titleLine, heading, 0, 1);
    this.revealLine(this.phaseLine, heading, 0.32, 0.92);
    this.copyLines.forEach((line, index) => {
      const lineStart = index * 0.18;
      this.revealLine(line, copy, lineStart, lineStart + 0.64);
    });
  }

  private prepareTextLine(selector: string): TextLine | null {
    if (!this.element) return null;
    const node = this.element.querySelector<HTMLElement>(selector);
    if (!node) return null;
    return this.splitTextNode(node);
  }

  private prepareTextLines(selector: string) {
    if (!this.element) return [];
    return Array.from(this.element.querySelectorAll<HTMLElement>(selector)).map((node) => this.splitTextNode(node));
  }

  private splitTextNode(node: HTMLElement): TextLine {
    const text = node.textContent ?? '';
    node.textContent = '';
    const chars: HTMLElement[] = [];

    for (let i = 0; i < text.length; i++) {
      const span = document.createElement('span');
      span.className = 'earth-overlay__char';
      span.textContent = text[i] === ' ' ? '\u00a0' : text[i];
      span.style.setProperty('--char-progress', '0');
      node.appendChild(span);
      chars.push(span);
    }

    return { chars };
  }

  private revealLine(line: TextLine | null, value: number, start: number, end: number) {
    if (!line) return;
    const lineProgress = smoothstep(start, end, clamp01(value));
    const count = Math.max(1, line.chars.length);

    line.chars.forEach((char, index) => {
      const charStart = index / count;
      const charEnd = Math.min(1, charStart + 5 / count);
      const progress = smoothstep(charStart, charEnd, lineProgress);
      char.style.setProperty('--char-progress', progress.toFixed(3));
    });
  }
}

/** 转场合成 shader 使用的地球雾化强度，和 overlay 共享同一份场景状态。 */
export function getEarthMistStrength(state?: SceneFrameState) {
  const focus = clamp01(state?.focus ?? 0);
  const local = clamp01(state?.sceneProgress ?? 0);
  const nearMist = 1 - smoothstep(0.06, 0.58, local);
  return focus * (0.5 + nearMist * 0.34);
}
