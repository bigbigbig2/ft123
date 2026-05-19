import './style.css';
import * as THREE from 'three';
import { Engine } from './core/Engine';
import { createDebugPanel } from './debug/createDebugPanel';
import { SharedBackdrop } from './render/SharedBackdrop';
import { TransitionRenderer } from './runtime/TransitionRenderer';
import { ScrollRig } from './scroll/ScrollRig';
import { SCROLL_STAGE_HEIGHT_VH, TIMELINE_SEGMENTS, createTimelineLayout } from './scroll/timelineConfig';
import { TimelineDirector } from './scroll/TimelineDirector';
import { EarthOverlay, getEarthMistStrength } from './ui/EarthOverlay';
import { VideoScene } from './scenes/VideoScene';
import { createEarthScene } from './scenes/EarthScene';
import { createScene1, createScene2 } from './scenes/placeholders';
import { loadKTX2Texture } from './utils/loaders';
import { damp } from './scroll/math';

// ── 资源路径配置 ────────────────────────────────────────────────
const VIDEO_SRC = '/videos/oceans.mp4';
const SCROLL_NOISE = '/textures/runtime/scroll-datatexture.ktx2';
const BLUE_NOISE = '/textures/runtime/blue-8-128-rgb.ktx2';
const PERLIN_DATA = '/textures/detail/perlin-datatexture.ktx2';
const DOT_PATTERN = '/textures/cubes/dot_pattern.ktx2';

const BOOT_LOADER_HIDE_DURATION_MS = 750;

// ── DOM 元素获取 ────────────────────────────────────────────────
const bootLoader = document.querySelector<HTMLElement>('[data-boot]');
const bootLabel = document.querySelector<HTMLElement>('[data-boot-label]');
const earthOverlayElement = document.querySelector<HTMLElement>('[data-earth-overlay]');

/** 更新启动加载页面的提示文字 */
function setBootMessage(message: string) {
  if (!bootLoader) return;
  bootLoader.setAttribute('aria-label', message);
  if (bootLabel) bootLabel.textContent = message;
}

/** 隐藏启动加载页面（带淡出动画） */
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
      // 监听 opacity 动画结束
      if (event.target === bootLoader && event.propertyName === 'opacity') complete();
    };

    bootLoader.addEventListener('transitionend', onTransitionEnd);
    // 安全兜底，防止某些浏览器不触发 transitionend
    window.setTimeout(complete, BOOT_LOADER_HIDE_DURATION_MS + 120);
  });

  bootLoader.remove();
}

/** 显示启动失败错误 */
function showBootError() {
  if (!bootLoader) return;
  bootLoader.classList.add('is-error');
  bootLoader.setAttribute('aria-busy', 'false');
  bootLoader.innerHTML = '<div class="boot-loader__error">Boot failed. Check the console and asset paths.</div>';
}

/**
 * bootstrap: 整个应用的启动入口。
 * 
 * 执行流程：
 * 1. 准备渲染引擎和画布。
 * 2. 异步加载全局纹理（KTX2 格式以优化显存）。
 * 3. 实例化各个 3D 场景。
 * 4. 建立滚动系统与时间线导演的连接。
 * 5. 设置后处理渲染管线。
 * 6. 开启核心循环。
 */
async function bootstrap() {
  const container = document.querySelector<HTMLDivElement>('[data-canvas]');
  const scrollProxy = document.querySelector<HTMLDivElement>('.scroll-proxy');
  if (!container || !scrollProxy) throw new Error('Missing DOM anchors.');

  // 1. 初始化引擎
  setBootMessage('Preparing renderer...');
  const engine = new Engine(container);

  // 2. 加载转场和后处理所需的纹理
  setBootMessage('Loading transition textures...');
  const [scrollTex, blueTex, perlinTex, dotTex] = await Promise.all([
    loadKTX2Texture(SCROLL_NOISE, engine.renderer, { repeat: [2, 2] }),
    loadKTX2Texture(BLUE_NOISE, engine.renderer, {
      minFilter: THREE.NearestFilter, // 蓝噪纹理必须使用邻近采样，保持像素独立性
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

  // 3. 加载场景
  setBootMessage('Loading scenes...');
  const videoScene = new VideoScene({
    src: VIDEO_SRC,
    name: 'intro-video',
    fit: 'cover',
    muted: true,
  });
  const earthScene = await createEarthScene();
  const scene1 = createScene1();
  const scene2 = createScene2();
  const sections = [videoScene, earthScene, scene1, scene2];

  // 4. 初始化显式滚动时间轴
  // scene 段负责场景自己的内容进度，transition 段负责两个场景之间的混合。
  const timeline = createTimelineLayout(TIMELINE_SEGMENTS);

  // 时间线导演负责协调各个场景的混合
  const director = new TimelineDirector(sections, timeline);

  // 设置滚动代理层的高度，从而产生真实的滚动距离
  scrollProxy.style.height = `${SCROLL_STAGE_HEIGHT_VH}vh`;

  // 初始化滚动控制器
  const scroll = new ScrollRig({
    snap: false, // 关闭场景段自动吸附，避免用户轻滚时被强行拉到段起点
    snapPoints: director.getSnapPoints(),// 从导演类获取场景段吸附点，后续需要恢复吸附时可直接复用
    lenisDuration: 0.72, // 调整 Lenis 的默认动画时长，使得自动滚动更平滑自然
    wheelMultiplier: 0.30,// 微调滚轮输入的缩放倍率，数值越小滚轮推进越慢
    wheelDeltaClamp: 120, // 限制单次滚轮事件的最大位移，防止某些鼠标一次滚动跳太远
  });

  // 5. 初始化背景与后处理渲染器
  const backdrop = new SharedBackdrop({
    perlinTexture: perlinTex,
    dotPatternTexture: dotTex,
    blueNoiseTexture: blueTex,
  });

  //  TransitionRenderer 负责在场景切换时执行复杂的视觉效果，它将作为 Engine 的主视图被驱动。
  const transition = new TransitionRenderer({
    scrollTexture: scrollTex,
    blueNoiseTexture: blueTex,
    backdrop,
    chromaticStrength: 0.36,
    edgeSoftness: 1.15,
  });

  // 设置转场后处理参数
  transition.setSmearStrength(0.42); // 运动模糊强度
  transition.setSmearLength(0.1); // 运动模糊长度
  transition.setFogWashStrength(0.52); // 雾化强度
  transition.setSceneBRevealStart(0.24); // 场景 B 的内容开始显现的混合进度

  // 6. UI 与 调试面板
  const introSegment = timeline.find((segment) => segment.type === 'scene' && segment.sceneName === 'intro-video');
  const brandStartProgress = introSegment
    ? introSegment.start + (introSegment.end - introSegment.start) * 0.5
    : 0;
  const earthOverlay = new EarthOverlay(earthOverlayElement, { brandStartProgress });
  const debugPanel = createDebugPanel({
    engine,
    scroll,
    director,
    transition,
    backdrop,
    sections,
    segments: timeline,
  });

  // 将后处理渲染器设为引擎的主视图
  engine.setView(transition);

  // 7. 绑定核心循环钩子
  let smoothedProgress = 0;

  engine.onTick((delta, elapsed, time) => {
    // a. 手动驱动滚动系统更新，确保滚动计算与 WebGL 渲染在同个 RAF 周期内，彻底消除抖动。
    scroll.update(time);

    // b. 获取滚动系统的最新状态
    const scrollState = scroll.getState();

    // c. 对全局进度进行“二次阻尼”处理。
    // 虽然 Lenis 已经有惯性，但通过对最终推给“导演”的进度再加一层 damp，
    // 可以产生更厚重的“阻尼感”，尤其是在地球出现这种大场景切换时。
    // 提高到 12，增加响应速度，使其更接近 OrbitControls 那种灵动但丝滑的追赶感。
    smoothedProgress = damp(smoothedProgress, scrollState.progress, 12, delta);

    // d. 导演类根据阻尼后的进度，计算出这一帧的“剧本”
    const frame = director.update(smoothedProgress, scrollState.velocity);

    // e. 将计算出的状态同步给渲染系统和 UI 系统
    const earthState = frame.sceneStates.get('earth');

    backdrop.setProgress(frame.globalProgress);

    // 切换渲染器的目标场景对
    transition.setSceneTargets(frame.current, frame.next);
    // 更新混合参数（mix）和运动模糊强度（velocity）
    transition.setMix(frame.mix, frame.velocity);

    // 地球场景特有的雾化强度同步
    transition.setSceneMistStrength(getEarthMistStrength(earthState));

    // 更新屏幕 UI 覆盖层
    earthOverlay.update(earthState, frame);
    // 更新调试面板数据
    debugPanel.update(frame, scrollState);
  });

  // 正式启动引擎
  engine.start();

  // 8. 交互解锁：处理浏览器静音策略，在用户第一次点击/按键后播放视频
  const unlock = () => {
    videoScene.video.play().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // 移除加载屏
  await hideBootLoader();

  // 将关键组件挂载到 window，方便在控制台调试
  (window as unknown as { __ft: unknown }).__ft = {
    engine,
    scroll,
    director,
    transition,
    backdrop,
    earthOverlay,
    debugPanel,
    sections,
    timeline,
  };
}

// 启动程序
bootstrap().catch((err) => {
  console.error('[FT] bootstrap failed:', err);
  showBootError();
});
