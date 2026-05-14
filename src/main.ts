/**
 * main.ts — 应用入口
 *
 * 职责：
 * 1. 初始化渲染引擎（Engine）
 * 2. 加载转场过渡所需的纹理资源（KTX2 格式）
 * 3. 构建场景列表（视频场景、地球场景、占位场景等）
 * 4. 创建滚动控制器（ScrollController）、场景栈（SceneStack）、
 *    共享背景（SharedBackdrop）和转场渲染器（TransitionRenderer）
 * 5. 启动渲染循环，并在每帧内驱动滚动进度同步
 * 6. 管理启动加载界面的显示与隐藏
 */
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

// ── 资源路径常量 ──────────────────────────────────────────────────
const VIDEO_SRC = '/videos/oceans.mp4';            // 首屏视频
const SCROLL_NOISE = '/textures/runtime/scroll-datatexture.ktx2'; // 滚动过渡纹理
const BLUE_NOISE = '/textures/runtime/blue-8-128-rgb.ktx2';       // 蓝噪声纹理（抖动用）
const PERLIN_DATA = '/textures/detail/perlin-datatexture.ktx2';   // 柏林噪声纹理（背景动效）
const DOT_PATTERN = '/textures/cubes/dot_pattern.ktx2';           // 点阵纹理（背景装饰）

/** 启动加载动画消失的过渡时长（毫秒） */
const BOOT_LOADER_HIDE_DURATION_MS = 750;

// ── 启动加载界面 DOM 引用 ─────────────────────────────────────────
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

/**
 * 更新启动加载界面上的提示文本
 * @param message - 要显示的提示信息
 */
function setBootMessage(message: string) {
  if (!bootLoader) return;
  bootLoader.setAttribute('aria-label', message);
  if (bootLabel) bootLabel.textContent = message;
}

/**
 * 隐藏并移除启动加载界面
 * 通过 CSS transition 实现淡出效果，等待动画完成后从 DOM 中移除元素。
 * 同时设置了一个超时兜底，防止 transitionend 事件未触发时卡住。
 */
async function hideBootLoader() {
  if (!bootLoader) return;

  // 添加 CSS 类触发淡出动画
  bootLoader.classList.add('is-hiding');
  bootLoader.setAttribute('aria-busy', 'false');

  await new Promise<void>((resolve) => {
    let settled = false;

    /** 确保只 resolve 一次 */
    const complete = () => {
      if (settled) return;
      settled = true;
      bootLoader.removeEventListener('transitionend', onTransitionEnd);
      resolve();
    };

    /** CSS transition 完成时的回调 */
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === bootLoader && event.propertyName === 'opacity') complete();
    };

    bootLoader.addEventListener('transitionend', onTransitionEnd);
    // 超时兜底：即使 transitionend 没有触发，也能正常继续
    window.setTimeout(complete, BOOT_LOADER_HIDE_DURATION_MS + 120);
  });

  // 动画结束后移除 DOM 节点
  bootLoader.remove();
}

/**
 * 显示启动失败的错误信息
 * 当 bootstrap() 发生异常时调用
 */
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
  // ── 1. 获取 DOM 锚点 ───────────────────────────────────────────
  const container = document.querySelector<HTMLDivElement>('[data-canvas]');    // 画布容器
  const scrollProxy = document.querySelector<HTMLDivElement>('.scroll-proxy'); // 滚动代理（撑高页面用）
  if (!container || !scrollProxy) throw new Error('Missing DOM anchors.');

  // ── 2. 初始化渲染引擎 ──────────────────────────────────────────
  setBootMessage('Preparing renderer...');
  const engine = new Engine(container);

  // ── 3. 并行加载所有转场过渡纹理 ────────────────────────────────
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

  // ── 4. 创建各场景 ─────────────────────────────────────────────
  setBootMessage('Loading scenes...');
  const videoScene = new VideoScene({ src: VIDEO_SRC, name: 'intro-video', fit: 'cover',muted:true });
  const earthScene = await createEarthScene(); // 地球场景（含模型和贴图加载）
  const scene1 = createScene1();       // 占位场景 1（蓝色立方体）
  const scene2 = createScene2();       // 占位场景 2（球体）
  const sections = [videoScene, earthScene, scene1, scene2];

  // 根据场景数量设置滚动代理的高度，使页面可以滚动
  scrollProxy.style.height = `${sections.length * 100}vh`;

  // ── 5. 实例化运行时组件 ────────────────────────────────────────
  /** 滚动控制器：将原生滚动映射为 0→1 的归一化进度 */
  const scroll = new ScrollController({
    sectionCount: sections.length,
    snap: false,               // 启用吸附
    snapIdleDelay: 240,       // 停止滚动后 240ms 开始吸附
    snapDuration: 1.08,       // 吸附动画总时长（秒）
  });

  /** 场景栈：根据全局滚动进度决定当前/下一场景及混合系数 */
  const stack = new SceneStack(sections, { transitionStart: 0.66, preloadMargin: 0.14 });

  /** 共享背景层：柏林噪声 + 点阵动态背景 */
  const backdrop = new SharedBackdrop({
    perlinTexture: perlinTex,
    dotPatternTexture: dotTex,
    blueNoiseTexture: blueTex,
  });

  /** 转场渲染器：双 RT 离屏渲染 + 合成着色器实现场景间过渡效果 */
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

  // 将转场渲染器设为引擎的主视图
  engine.setView(transition);

  // ── 6. 注册每帧回调 ────────────────────────────────────────────
  engine.onTick((_delta, _elapsed, time) => {
    // 驱动 Lenis 平滑滚动
    scroll.raf(time);
    // 将滚动进度同步到背景层
    backdrop.setProgress(scroll.progress);

    // 根据滚动进度获取当前/下一场景及混合系数
    const { current, next, blend } = stack.sync(scroll.progress);
    // 将场景对和混合参数传递给转场渲染器
    transition.setSceneTargets(current, next);
    transition.setMix(blend, scroll.velocity);
    updateEarthPresentation(getSectionFocus(scroll.progress, 1, sections.length), transition);
    debugGui.update();
  });

  // ── 7. 启动渲染循环 ────────────────────────────────────────────
  engine.start();

  // ── 8. 解锁视频自动播放 ────────────────────────────────────────
  // 部分浏览器需要用户交互后才允许播放视频
  const unlock = () => {
    videoScene.video.play().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // ── 9. 隐藏启动加载界面 ────────────────────────────────────────
  await hideBootLoader();

  // ── 10. 暴露调试接口到全局 ─────────────────────────────────────
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

// ── 启动！ ────────────────────────────────────────────────────────
bootstrap().catch((err) => {
  console.error('[FT] bootstrap failed:', err);
  showBootError();
});
