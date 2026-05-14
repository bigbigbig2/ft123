import './style.css';
import * as THREE from 'three';
import { Engine } from './core/Engine';
import { ScrollController } from './runtime/ScrollController';
import { SceneStack } from './runtime/SceneStack';
import { TransitionRenderer } from './runtime/TransitionRenderer';
import { SharedBackdrop } from './render/SharedBackdrop';
import { VideoScene } from './scenes/VideoScene';
import { createEarthScene } from './scenes/EarthScene';
import { createScene1, createScene2 } from './scenes/placeholders';
import { loadKTX2Texture } from './utils/loaders';
import { createDebugGui } from './debug/createDebugGui';

const VIDEO_SRC = '/videos/oceans.mp4';
const SCROLL_NOISE = '/textures/runtime/scroll-datatexture.ktx2';
const BLUE_NOISE = '/textures/runtime/blue-8-128-rgb.ktx2';
const PERLIN_DATA = '/textures/detail/perlin-datatexture.ktx2';
const DOT_PATTERN = '/textures/cubes/dot_pattern.ktx2';

const BOOT_LOADER_HIDE_DURATION_MS = 750;
const SECTION_SCROLL_HEIGHT_VH = 150;

const bootLoader = document.querySelector<HTMLElement>('[data-boot]');
const bootLabel = document.querySelector<HTMLElement>('[data-boot-label]');
const earthOverlay = document.querySelector<HTMLElement>('[data-earth-overlay]');

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.min(1, Math.max(0, (value - edge0) / Math.max(edge1 - edge0, 0.0001)));
  return x * x * (3 - 2 * x);
}

function getSectionFocus(globalProgress: number, sectionIndex: number, sectionCount: number) {
  const segments = Math.max(sectionCount - 1, 1);
  const scaled = globalProgress * segments;
  const distance = Math.abs(scaled - sectionIndex);
  return 1 - smoothstep(0.56, 1.04, distance);
}

function updateEarthPresentation(focus: number, transition: TransitionRenderer) {
  const strength = Math.min(1, Math.max(0, focus));
  transition.setSceneMistStrength(strength * 0.82);
  earthOverlay?.style.setProperty('--earth-overlay-opacity', strength.toFixed(3));
}

function setBootMessage(message: string) {
  if (!bootLoader) return;
  bootLoader.setAttribute('aria-label', message);
  if (bootLabel) bootLabel.textContent = message;
}

async function hideBootLoader() {
  if (!bootLoader) return;

  bootLoader.classList.add('is-hiding');
  bootLoader.setAttribute('aria-busy', 'false');

  await new Promise<void>((resolve) => {
    let settled = false;

    const complete = () => {
      if (settled) return;
      settled = true;
      bootLoader.removeEventListener('transitionend', onTransitionEnd);
      resolve();
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === bootLoader && event.propertyName === 'opacity') complete();
    };

    bootLoader.addEventListener('transitionend', onTransitionEnd);
    window.setTimeout(complete, BOOT_LOADER_HIDE_DURATION_MS + 120);
  });

  bootLoader.remove();
}

function showBootError() {
  if (!bootLoader) return;
  bootLoader.classList.add('is-error');
  bootLoader.setAttribute('aria-busy', 'false');
  bootLoader.innerHTML = '<div class="boot-loader__error">Boot failed. Check the console and asset paths.</div>';
}

async function bootstrap() {
  const container = document.querySelector<HTMLDivElement>('[data-canvas]');
  const scrollProxy = document.querySelector<HTMLDivElement>('.scroll-proxy');
  if (!container || !scrollProxy) throw new Error('Missing DOM anchors.');

  setBootMessage('Preparing renderer...');
  const engine = new Engine(container);

  setBootMessage('Loading original transition textures...');
  const [scrollTex, blueTex, perlinTex, dotTex] = await Promise.all([
    loadKTX2Texture(SCROLL_NOISE, engine.renderer, { repeat: [2, 2] }),
    loadKTX2Texture(BLUE_NOISE, engine.renderer, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    }),
    loadKTX2Texture(PERLIN_DATA, engine.renderer, {
      colorSpace: THREE.SRGBColorSpace,
      repeat: [2, 2],
    }),
    loadKTX2Texture(DOT_PATTERN, engine.renderer, {
      colorSpace: THREE.SRGBColorSpace,
      repeat: [2, 2],
    }),
  ]);

  setBootMessage('Loading scenes...');
  const videoScene = new VideoScene({ src: VIDEO_SRC, name: 'intro-video', fit: 'cover', muted: true });
  const earthScene = await createEarthScene();
  const scene1 = createScene1();
  const scene2 = createScene2();
  const sections = [videoScene, earthScene, scene1, scene2];

  scrollProxy.style.height = `${100 + (sections.length - 1) * SECTION_SCROLL_HEIGHT_VH}vh`;

  const stack = new SceneStack(sections, {
    transitionStart: 0.52,
    transitionEnd: 0.84,
    preloadMargin: 0.16,
    boundaryHysteresis: 0.016,
  });

  const scroll = new ScrollController({
    sectionCount: sections.length,
    snap: false,
    snapIdleDelay: 420,
    snapDuration: 0.86,
    displayDamping: 14,
    velocityDamping: 11,
    wheelMultiplier: 0.82,
  });
  scroll.setSnapPoints(stack.getSnapPoints());

  const backdrop = new SharedBackdrop({
    perlinTexture: perlinTex,
    dotPatternTexture: dotTex,
    blueNoiseTexture: blueTex,
  });

  const transition = new TransitionRenderer({
    scrollTexture: scrollTex,
    blueNoiseTexture: blueTex,
    backdrop,
  });

  const debugGui = createDebugGui({
    engine,
    scroll,
    stack,
    transition,
    backdrop,
    sections,
  });

  engine.setView(transition);

  engine.onTick((_delta, _elapsed, time) => {
    scroll.raf(time);
    backdrop.setProgress(scroll.progress);

    const { current, next, blend } = stack.sync(scroll.progress);
    transition.setSceneTargets(current, next);
    transition.setMix(blend, scroll.velocity);
    updateEarthPresentation(getSectionFocus(scroll.progress, 1, sections.length), transition);
    debugGui.update();
  });

  engine.start();

  const unlock = () => {
    videoScene.video.play().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  await hideBootLoader();

  (window as unknown as { __ft: unknown }).__ft = {
    engine,
    scroll,
    stack,
    transition,
    backdrop,
    debugGui,
    sections,
  };
}

bootstrap().catch((err) => {
  console.error('[FT] bootstrap failed:', err);
  showBootError();
});
