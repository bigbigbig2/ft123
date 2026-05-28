import type { SceneFrameState, TimelineFrame } from '../scroll/TimelineDirector';

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.min(1, Math.max(0, (value - edge0) / Math.max(edge1 - edge0, 0.0001)));
  return x * x * (3 - 2 * x);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function easeOutBack(value: number, overshoot: number) {
  const t = clamp01(value) - 1;
  return 1 + (overshoot + 1) * t * t * t + overshoot * t * t;
}

function formatPx(value: number) {
  return `${value.toFixed(2)}px`;
}

interface EarthOverlayOptions {
  brandStartProgress?: number;
  brandEnabled?: boolean;
  brandVisible?: () => boolean;
}

type TextRole = 'title' | 'phase' | 'copy';

interface TextLine {
  chars: HTMLElement[];
  role: TextRole;
}

interface RevealProfile {
  staggerRange: number;
  popSpan: number;
  startScale: number;
  overshoot: number;
  liftPx: number;
  blurPx: number;
  glowPx: number;
  glowAlpha: number;
}

const REVEAL_PROFILES: Record<TextRole, RevealProfile> = {
  title: {
    staggerRange: 0.82,
    popSpan: 0.16,
    startScale: 0.46,
    overshoot: 1.28,
    liftPx: 14,
    blurPx: 1.2,
    glowPx: 18,
    glowAlpha: 0.62,
  },
  phase: {
    staggerRange: 0.72,
    popSpan: 0.2,
    startScale: 0.58,
    overshoot: 1.05,
    liftPx: 9,
    blurPx: 0.8,
    glowPx: 10,
    glowAlpha: 0.42,
  },
  copy: {
    staggerRange: 0.76,
    popSpan: 0.18,
    startScale: 0.52,
    overshoot: 1.16,
    liftPx: 11,
    blurPx: 0.9,
    glowPx: 13,
    glowAlpha: 0.5,
  },
};

/**
 * DOM overlay controller for the Earth chapter.
 *
 * The text reveal is intentionally scroll-driven instead of CSS-keyframed:
 * each character receives explicit pop/glow variables every frame, which keeps
 * the typography locked to the page timeline while still feeling like typed
 * characters are popping into place.
 */
export class EarthOverlay {
  private readonly brandStartProgress: number;
  private readonly brandElement: HTMLElement | null;
  private readonly brandEnabled: boolean;
  private readonly brandVisible: (() => boolean) | null;
  private readonly brandVideo: HTMLVideoElement | null;
  private readonly titleLine: TextLine | null;
  private readonly phaseLine: TextLine | null;
  private readonly copyLines: TextLine[];
  private brandVideoPlayed = false;

  constructor(
    private readonly element: HTMLElement | null,
    opts: EarthOverlayOptions = {},
  ) {
    this.brandStartProgress = opts.brandStartProgress ?? 0;
    this.brandElement = this.element?.querySelector<HTMLElement>('.earth-overlay__brand') ?? null;
    this.brandEnabled = opts.brandEnabled ?? !!this.brandElement;
    this.brandVisible = opts.brandVisible ?? null;
    this.brandVideo = this.element?.querySelector<HTMLVideoElement>('.earth-overlay__brand-video') ?? null;
    this.titleLine = this.prepareTextLine('.earth-overlay__title', 'title');
    this.phaseLine = this.prepareTextLine('.earth-overlay__phase', 'phase');
    this.copyLines = this.prepareTextLines('.earth-overlay__copy p', 'copy');
  }

  update(state?: SceneFrameState, frame?: TimelineFrame) {
    if (!this.element) return;

    const focus = clamp01(state?.focus ?? 0);
    const local = clamp01(state?.sceneProgress ?? 0);
    const global = clamp01(frame?.globalProgress ?? 0);
    const brand = this.getBrandProgress(global);
    const heading = focus * smoothstep(0.46, 0.7, local);
    const frameOpacity = focus * smoothstep(0.36, 0.66, local);
    const copy = focus * smoothstep(0.64, 0.88, local);

    this.element.style.setProperty('--earth-overlay-opacity', Math.max(focus, brand).toFixed(3));
    this.element.style.setProperty('--earth-brand-opacity', brand.toFixed(3));
    this.element.style.setProperty('--earth-heading-opacity', heading.toFixed(3));
    this.element.style.setProperty('--earth-frame-opacity', frameOpacity.toFixed(3));
    this.element.style.setProperty('--earth-copy-opacity', copy.toFixed(3));

    this.updateBrandVideo(brand);
    this.revealLine(this.titleLine, heading, 0, 1);
    this.revealLine(this.phaseLine, heading, 0.28, 0.86);
    this.copyLines.forEach((line, index) => {
      const lineStart = index * 0.2;
      this.revealLine(line, copy, lineStart, lineStart + 0.58);
    });
  }

  private getBrandProgress(global: number) {
    if (!this.brandEnabled) return 0;
    if (this.brandVisible) return this.brandVisible() ? 1 : 0;
    return smoothstep(this.brandStartProgress, this.brandStartProgress + 0.035, global);
  }

  private prepareTextLine(selector: string, role: TextRole): TextLine | null {
    if (!this.element) return null;
    const node = this.element.querySelector<HTMLElement>(selector);
    if (!node) return null;
    return this.splitTextNode(node, role);
  }

  private prepareTextLines(selector: string, role: TextRole) {
    if (!this.element) return [];
    return Array.from(this.element.querySelectorAll<HTMLElement>(selector)).map((node) => (
      this.splitTextNode(node, role)
    ));
  }

  private splitTextNode(node: HTMLElement, role: TextRole): TextLine {
    const text = node.textContent ?? '';
    node.textContent = '';
    const chars: HTMLElement[] = [];

    for (let i = 0; i < text.length; i++) {
      const span = document.createElement('span');
      span.className = 'earth-overlay__char';
      span.textContent = text[i] === ' ' ? '\u00a0' : text[i];
      this.applyCharVars(span, 0, REVEAL_PROFILES[role]);
      node.appendChild(span);
      chars.push(span);
    }

    return { chars, role };
  }

  private revealLine(line: TextLine | null, value: number, start: number, end: number) {
    if (!line) return;

    const profile = REVEAL_PROFILES[line.role];
    const lineProgress = smoothstep(start, end, clamp01(value));
    const lastIndex = Math.max(1, line.chars.length - 1);

    line.chars.forEach((char, index) => {
      const charStart = (index / lastIndex) * profile.staggerRange;
      const progress = smoothstep(charStart, charStart + profile.popSpan, lineProgress);
      this.applyCharVars(char, progress, profile);
    });
  }

  private applyCharVars(char: HTMLElement, progress: number, profile: RevealProfile) {
    const opacity = smoothstep(0, 0.42, progress);
    const back = easeOutBack(progress, profile.overshoot);
    const pop = Math.sin(Math.PI * clamp01(progress));
    const scale = profile.startScale + (1 - profile.startScale) * back;
    const y = (1 - progress) * profile.liftPx - pop * 3;
    const blur = (1 - progress) * profile.blurPx;
    const glowSize = opacity * (6 + pop * profile.glowPx);
    const glowAlpha = opacity * (0.2 + pop * profile.glowAlpha);

    char.style.setProperty('--char-opacity', opacity.toFixed(3));
    char.style.setProperty('--char-scale', scale.toFixed(3));
    char.style.setProperty('--char-y', formatPx(y));
    char.style.setProperty('--char-blur', formatPx(blur));
    char.style.setProperty('--char-glow-size', formatPx(glowSize));
    char.style.setProperty('--char-glow-alpha', glowAlpha.toFixed(3));
  }

  private updateBrandVideo(brandProgress: number) {
    if (!this.brandVideo) return;

    if (brandProgress <= 0.005) {
      this.brandVideo.pause();
      this.brandVideo.currentTime = 0;
      this.brandVideoPlayed = false;
      return;
    }

    if (brandProgress > 0.02 && !this.brandVideoPlayed) {
      this.brandVideo.currentTime = 0;
      this.brandVideoPlayed = true;
      this.brandVideo.play().catch(() => {
        // Muted inline video should autoplay, but keeping this silent avoids
        // interrupting boot if a browser policy still blocks it.
      });
    }
  }
}

/** Shared Earth mist strength for the transition composite shader. */
export function getEarthMistStrength(state?: SceneFrameState) {
  const focus = clamp01(state?.focus ?? 0);
  const local = clamp01(state?.sceneProgress ?? 0);
  const nearMist = 1 - smoothstep(0.06, 0.58, local);
  return focus * (0.5 + nearMist * 0.34);
}
