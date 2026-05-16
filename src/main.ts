import './style.css';
import * as THREE from 'three';
import { Engine } from './core/Engine';
import { createDebugPanel } from './debug/createDebugPanel';
import { SharedBackdrop } from './render/SharedBackdrop';
import { TransitionRenderer } from './runtime/TransitionRenderer';
import { ScrollRig } from './scroll/ScrollRig';
import { CHAPTERS, SCROLL_STAGE_HEIGHT_VH, createChapterLayout } from './scroll/chapterConfig';
import { TimelineDirector } from './scroll/TimelineDirector';
import { EarthOverlay, getEarthMistStrength } from './ui/EarthOverlay';
import { VideoScene } from './scenes/VideoScene';
import { createEarthScene } from './scenes/EarthScene';
import { createScene1, createScene2 } from './scenes/placeholders';
import { loadKTX2Texture } from './utils/loaders';

const VIDEO_SRC = '/videos/oceans.mp4';
const SCROLL_NOISE = '/textures/runtime/scroll-datatexture.ktx2';
const BLUE_NOISE = '/textures/runtime/blue-8-128-rgb.ktx2';
const PERLIN_DATA = '/textures/detail/perlin-datatexture.ktx2';
const DOT_PATTERN = '/textures/cubes/dot_pattern.ktx2';

const BOOT_LOADER_HIDE_DURATION_MS = 750;

const bootLoader = document.querySelector<HTMLElement>('[data-boot]');
const bootLabel = document.querySelector<HTMLElement>('[data-boot-label]');
const earthOverlayElement = document.querySelector<HTMLElement>('[data-earth-overlay]');

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
  // 主入口只负责装配：资源加载、场景创建、滚动导演、渲染合成和调试面板。
  const container = document.querySelector<HTMLDivElement>('[data-canvas]');
  const scrollProxy = document.querySelector<HTMLDivElement>('.scroll-proxy');
  if (!container || !scrollProxy) throw new Error('Missing DOM anchors.');

  setBootMessage('Preparing renderer...');
  const engine = new Engine(container);

  setBootMessage('Loading transition textures...');
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

  const chapters = createChapterLayout(CHAPTERS);
  const director = new TimelineDirector(sections, chapters);
  // 真实页面高度只承担滚动输入，不直接承载内容布局。
  scrollProxy.style.height = `${SCROLL_STAGE_HEIGHT_VH}vh`;

  const scroll = new ScrollRig({
    snap: true,
    snapPoints: director.getSnapPoints(),
    lenisDuration: 0.72,
    wheelMultiplier: 0.95,
    wheelDeltaClamp: 180,
  });

  const backdrop = new SharedBackdrop({
    perlinTexture: perlinTex,
    dotPatternTexture: dotTex,
    blueNoiseTexture: blueTex,
  });

  const transition = new TransitionRenderer({
    scrollTexture: scrollTex,
    blueNoiseTexture: blueTex,
    backdrop,
    chromaticStrength: 0.36,
    edgeSoftness: 1.15,
  });

  transition.setSmearStrength(0.42);
  transition.setSmearLength(0.1);
  transition.setFogWashStrength(0.52);
  transition.setSceneBRevealStart(0.44);

  const earthOverlay = new EarthOverlay(earthOverlayElement);
  const debugPanel = createDebugPanel({
    engine,
    scroll,
    director,
    transition,
    backdrop,
    sections,
    chapters,
  });

  engine.setView(transition);

  engine.onTick(() => {
    // 每帧只有 ScrollRig -> TimelineDirector 这一条状态流，避免多个模块重复推导滚动进度。
    const scrollState = scroll.getState();
    const frame = director.update(scrollState.progress, scrollState.velocity);
    const earthState = frame.sceneStates.get('earth');

    backdrop.setProgress(frame.globalProgress);
    transition.setSceneTargets(frame.current, frame.next);
    transition.setMix(frame.mix, frame.velocity);
    transition.setSceneMistStrength(getEarthMistStrength(earthState));
    earthOverlay.update(earthState);
    debugPanel.update(frame, scrollState);
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
    director,
    transition,
    backdrop,
    earthOverlay,
    debugPanel,
    sections,
    chapters,
  };
}

bootstrap().catch((err) => {
  console.error('[FT] bootstrap failed:', err);
  showBootError();
});
