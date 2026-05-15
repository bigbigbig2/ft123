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
const SECTION_SCROLL_HEIGHT_VH = 180;

const bootLoader = document.querySelector<HTMLElement>('[data-boot]');
const bootLabel = document.querySelector<HTMLElement>('[data-boot-label]');
const earthOverlay = document.querySelector<HTMLElement>('[data-earth-overlay]');

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.min(1, Math.max(0, (value - edge0) / Math.max(edge1 - edge0, 0.0001)));
  return x * x * (3 - 2 * x);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function getSectionFocus(globalProgress: number, sectionIndex: number, sectionCount: number) {
  const segments = Math.max(sectionCount - 1, 1);
  const scaled = globalProgress * segments;
  const distance = Math.abs(scaled - sectionIndex);
  return 1 - smoothstep(0.36, 0.86, distance);
}

function getSectionLocal(globalProgress: number, sectionIndex: number, sectionCount: number) {
  const segments = Math.max(sectionCount - 1, 1);
  return clamp01(globalProgress * segments - sectionIndex);
}

function updateEarthPresentation(focus: number, local: number, transition: TransitionRenderer) {
  const strength = clamp01(focus);
  const nearMist = 1 - smoothstep(0.06, 0.58, local);
  const heading = strength * smoothstep(0.46, 0.7, local);
  const frame = strength * smoothstep(0.36, 0.66, local);
  const copy = strength * smoothstep(0.64, 0.88, local);

  transition.setSceneMistStrength(strength * (0.5 + nearMist * 0.34));
  earthOverlay?.style.setProperty('--earth-overlay-opacity', strength.toFixed(3));
  earthOverlay?.style.setProperty('--earth-brand-opacity', strength.toFixed(3));
  earthOverlay?.style.setProperty('--earth-heading-opacity', heading.toFixed(3));
  earthOverlay?.style.setProperty('--earth-frame-opacity', frame.toFixed(3));
  earthOverlay?.style.setProperty('--earth-copy-opacity', copy.toFixed(3));
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

/**
 * 应用主引导函数
 *
 * 整体流程：
 *   DOM 锚点获取 → 引擎初始化 → 纹理加载 → 场景构建
 *   → 滚动控制 / 场景栈 / 背景 / 过渡渲染器实例化
 *   → 渲染循环启动 → 视频自动播放解锁 → 启动界面隐藏
 */
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

  // 撑开页面的高度，使原生的滚动条出现
  scrollProxy.style.height = `${100 + (sections.length - 1) * SECTION_SCROLL_HEIGHT_VH}vh`;

  // 实例化场景栈大管家
  const stack = new SceneStack(sections, {
    transitionStart: 0.52,      // 0.0~0.52 为驻留期，0.52 之后开始转场
    transitionEnd: 0.84,        // 0.84 时转场达到 100% (blend = 1.0)
    preloadMargin: 0.16,        // 预加载裕量：在转场开始前提前激活下一场景
    boundaryHysteresis: 0.016,  // 边界迟滞：防止在两个段落交界处反复横跳闪烁
    segmentTransitions: {
      0: {
        transitionStart: 0.62,
        transitionEnd: 0.82,
        preloadMargin: 0.1,
      },
      1: {
        transitionStart: 0.82,
        transitionEnd: 0.96,
        preloadMargin: 0.08,
      },
    },
  });

  // 实例化物理滚动控制器
  const scroll = new ScrollController({
    sectionCount: sections.length,
    snap: false,              // 自动吸附（重构时暂时关闭）
    snapIdleDelay: 420,       // 停止滚动多少毫秒后触发吸附
    snapDuration: 0.86,       // 吸附动画的时长
    displayDamping: 14,       // 进度平滑阻尼
    velocityDamping: 11,      // 速度平滑阻尼 (传给 Shader 的速度)
    wheelMultiplier: 0.82,    // 鼠标滚轮强度缩放
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

    const { current, next, blend } = stack.sync(scroll.progress, scroll.velocity);
    transition.setSceneTargets(current, next);
    transition.setMix(blend, scroll.velocity);
    updateEarthPresentation(
      getSectionFocus(scroll.progress, 1, sections.length),
      getSectionLocal(scroll.progress, 1, sections.length),
      transition,
    );
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
