import { Pane } from 'tweakpane';
import type { Engine } from '../core/Engine';
import type { SharedBackdrop } from '../render/SharedBackdrop';
import type { TransitionRenderer } from '../runtime/TransitionRenderer';
import type { CloudSpriteDebugParams } from '../runtime/CloudSpriteTransitionLayer';
import type { ScrollRig, ScrollRigState } from '../scroll/ScrollRig';
import type { TimelineDirector, TimelineFrame } from '../scroll/TimelineDirector';
import {
  getSceneLabelMap,
  isSceneSegment,
  isTransitionSegment,
  type TimelineSegmentLayout,
} from '../scroll/timelineConfig';
import type { SceneBase } from '../scenes/SceneBase';
import { isEarthDebugScene } from '../scenes/EarthScene';
import type { EarthDebugSingleLightState } from '../scenes/EarthScene';

export interface DebugPanelOptions {
  engine: Engine;
  scroll: ScrollRig;
  director: TimelineDirector;
  transition: TransitionRenderer;
  backdrop: SharedBackdrop;
  sections: SceneBase[];
  segments: TimelineSegmentLayout[];
}

export interface DebugPanel {
  update(frame: TimelineFrame, scrollState: ScrollRigState): void;
  destroy(): void;
}

function createContainer() {
  const container = document.createElement('div');
  container.className = 'ft-debug-panel';

  const style = document.createElement('style');
  style.textContent = `
    .ft-debug-panel::-webkit-scrollbar {
      width: 4px;
      display: block !important;
    }
    .ft-debug-panel::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.05);
    }
    .ft-debug-panel::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.22);
      border-radius: 2px;
    }
    .ft-debug-panel::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.35);
    }
  `;
  document.head.appendChild(style);

  Object.assign(container.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    width: '360px',
    maxHeight: 'calc(100vh - 24px)',
    overflowX: 'hidden',
    overflowY: 'auto',
    zIndex: '999',
    scrollbarWidth: 'thin',
    scrollbarColor: 'rgba(255, 255, 255, 0.22) transparent',
  });
  document.body.appendChild(container);
  return container;
}

function shouldIgnoreToggle(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function getSceneDisplayName(sceneName: string, sceneLabels: Map<string, string>) {
  return sceneLabels.get(sceneName) ?? sceneName;
}

function isCloudDebugTarget(scene: SceneBase): scene is SceneBase & {
  getCloudDebugParams(): CloudSpriteDebugParams;
  applyCloudDebugParams(params: CloudSpriteDebugParams): void;
} {
  const target = scene as SceneBase & {
    getCloudDebugParams?: unknown;
    applyCloudDebugParams?: unknown;
  };
  return typeof target.getCloudDebugParams === 'function' && typeof target.applyCloudDebugParams === 'function';
}

function addLightFolder(
  parent: ReturnType<Pane['addFolder']>,
  title: string,
  state: EarthDebugSingleLightState,
  apply: () => void,
) {
  const folder = parent.addFolder({ title, expanded: false });
  folder.addBinding(state, 'enabled', { label: '启用' }).on('change', apply);
  folder.addBinding(state, 'color', { label: '颜色' }).on('change', apply);
  folder.addBinding(state, 'intensity', { min: 0, max: 6, step: 0.01, label: '强度' }).on('change', apply);
}

export function createDebugPanel(opts: DebugPanelOptions): DebugPanel {
  const container = createContainer();
  const sceneLabels = getSceneLabelMap(opts.segments);
  const pane = new Pane({
    title: 'FT 调试面板',
    container,
    expanded: true,
  });

  const runtime = {
    progress: 0,
    velocity: 0,
    rawVelocity: 0,
    direction: 0,
    segmentType: '',
    activeSegment: '',
    currentScene: '',
    nextScene: '',
    segmentProgress: 0,
    sceneProgress: 0,
    transitionProgress: 0,
    mix: 0,
  };

  const runtimeFolder = pane.addFolder({ title: '运行状态', expanded: true });
  runtimeFolder.addBinding(runtime, 'progress', { readonly: true, label: '全局进度', format: (value) => value.toFixed(3) });
  runtimeFolder.addBinding(runtime, 'velocity', { readonly: true, label: '归一速度', format: (value) => value.toFixed(3) });
  runtimeFolder.addBinding(runtime, 'rawVelocity', { readonly: true, label: '原始速度', format: (value) => value.toFixed(0) });
  runtimeFolder.addBinding(runtime, 'direction', { readonly: true, label: '方向' });
  runtimeFolder.addBinding(runtime, 'segmentType', { readonly: true, label: '段类型' });
  runtimeFolder.addBinding(runtime, 'activeSegment', { readonly: true, label: '当前段' });
  runtimeFolder.addBinding(runtime, 'currentScene', { readonly: true, label: '当前场景' });
  runtimeFolder.addBinding(runtime, 'nextScene', { readonly: true, label: '下一场景' });
  runtimeFolder.addBinding(runtime, 'segmentProgress', { readonly: true, label: '段进度', format: (value) => value.toFixed(3) });
  runtimeFolder.addBinding(runtime, 'sceneProgress', { readonly: true, label: '场景进度', format: (value) => value.toFixed(3) });
  runtimeFolder.addBinding(runtime, 'transitionProgress', { readonly: true, label: '转场进度', format: (value) => value.toFixed(3) });
  runtimeFolder.addBinding(runtime, 'mix', { readonly: true, label: '转场混合', format: (value) => value.toFixed(3) });

  const actionsFolder = pane.addFolder({ title: '场景跳转', expanded: false });
  for (const segment of opts.director.getSceneSegments()) {
    actionsFolder
      .addButton({ title: `跳转到 ${segment.label}` })
      .on('click', () => opts.scroll.scrollToProgress(segment.start, { duration: 0.55 }));
  }
  actionsFolder
    .addButton({ title: '跳转到结尾' })
    .on('click', () => opts.scroll.scrollToProgress(1, { duration: 0.55 }));

  const scrollParams = opts.scroll.getDebugParams();
  const scrollFolder = pane.addFolder({ title: '滚动输入', expanded: false });
  scrollFolder
    .addBinding(scrollParams, 'wheelInputScale', { min: 0.02, max: 1.2, step: 0.01, label: '滚轮倍率' })
    .on('change', () => opts.scroll.applyDebugParams(scrollParams));
  scrollFolder
    .addBinding(scrollParams, 'wheelDeltaClamp', { min: 12, max: 240, step: 1, label: '滚轮上限' })
    .on('change', () => opts.scroll.applyDebugParams(scrollParams));

  const earthScene = opts.sections.find(isEarthDebugScene);
  if (earthScene) {
    const earthDebug = earthScene.getEarthDebugData();
    const applyEarthDebug = () => earthScene.applyEarthDebug();

    const earthFolder = pane.addFolder({ title: 'Earth 调试', expanded: true });

    const earthStage = earthFolder.addFolder({ title: '舞台元素', expanded: false });
    earthStage.addBinding(earthDebug.stage, 'forceRingVisible', { label: '强制显示环' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'forceTextVisible', { label: '强制显示文字' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'ringYOffsetStart', { min: -1, max: 1, step: 0.001, label: '环 Y 起点' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'ringYOffsetEnd', { min: -1, max: 1, step: 0.001, label: '环 Y 终点' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'textYOffsetStart', { min: -1, max: 1, step: 0.001, label: '文字 Y 起点' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'textYOffsetEnd', { min: -1, max: 1, step: 0.001, label: '文字 Y 终点' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'ringScaleStart', { min: 0.5, max: 2, step: 0.001, label: '环缩放起点' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'ringScaleEnd', { min: 0.5, max: 2, step: 0.001, label: '环缩放终点' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'textScaleStart', { min: 0.5, max: 2, step: 0.001, label: '文字缩放起点' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'textScaleEnd', { min: 0.5, max: 2, step: 0.001, label: '文字缩放终点' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'textOpacityMax', { min: 0, max: 1.5, step: 0.001, label: '文字最大透明度' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'ringOpacityBase', { min: 0, max: 1, step: 0.001, label: '环基础透明度' }).on('change', applyEarthDebug);
    earthStage.addBinding(earthDebug.stage, 'ringEmissiveBase', { min: 0, max: 2, step: 0.001, label: '环发光强度' }).on('change', applyEarthDebug);

    const earthGlobe = earthFolder.addFolder({ title: '地球材质', expanded: false });
    earthGlobe.addBinding(earthDebug.globe, 'bumpScale', { min: 0, max: 0.05, step: 0.0005, label: '凹凸强度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudLow', { min: 0, max: 1, step: 0.001, label: '云层低阈值' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudHigh', { min: 0, max: 1, step: 0.001, label: '云层高阈值' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudOpacity', { min: 0, max: 1.5, step: 0.001, label: '云层透明度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudColor', { label: '云层颜色' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'roughnessLow', { min: 0, max: 1.2, step: 0.001, label: '粗糙度低值' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'roughnessHigh', { min: 0, max: 1.2, step: 0.001, label: '粗糙度高值' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'nightIntensity', { min: 0, max: 8, step: 0.01, label: '夜景强度' }).on('change', applyEarthDebug);

    const earthAtmosphere = earthFolder.addFolder({ title: '大气', expanded: false });
    earthAtmosphere.addBinding(earthDebug.atmosphere, 'atmosphereDayColor', { label: '日侧大气色' }).on('change', applyEarthDebug);
    earthAtmosphere.addBinding(earthDebug.atmosphere, 'atmosphereTwilightColor', { label: '暮光大气色' }).on('change', applyEarthDebug);
    earthAtmosphere.addBinding(earthDebug.atmosphere, 'sunDirX', { min: -1, max: 1, step: 0.001, label: '太阳方向 X' }).on('change', applyEarthDebug);
    earthAtmosphere.addBinding(earthDebug.atmosphere, 'sunDirY', { min: -1, max: 1, step: 0.001, label: '太阳方向 Y' }).on('change', applyEarthDebug);
    earthAtmosphere.addBinding(earthDebug.atmosphere, 'sunDirZ', { min: -1, max: 1, step: 0.001, label: '太阳方向 Z' }).on('change', applyEarthDebug);
    earthAtmosphere.addBinding(earthDebug.atmosphere, 'atmosphereScale', { min: 1, max: 1.2, step: 0.001, label: '大气缩放' }).on('change', applyEarthDebug);

    const earthLights = earthFolder.addFolder({ title: '光照', expanded: false });
    addLightFolder(earthLights, '环境光', earthDebug.lights.ambient, applyEarthDebug);
    addLightFolder(earthLights, '主方向光', earthDebug.lights.key, applyEarthDebug);
    addLightFolder(earthLights, '补光', earthDebug.lights.fill, applyEarthDebug);
    addLightFolder(earthLights, '太阳光', earthDebug.lights.sun, applyEarthDebug);

    earthFolder.addButton({ title: '重置 Earth 参数' }).on('click', () => {
      earthScene.resetEarthDebug();
    });
  }

  const timelineFolder = pane.addFolder({ title: '时间轴结构', expanded: false });
  for (const segment of opts.director.getSegments()) {
    const info = {
      type: segment.type === 'scene' ? '场景段' : '转场段',
      start: segment.start,
      end: segment.end,
      duration: segment.duration,
      route: isSceneSegment(segment)
        ? getSceneDisplayName(segment.sceneName, sceneLabels)
        : `${getSceneDisplayName(segment.from, sceneLabels)} -> ${getSceneDisplayName(segment.to, sceneLabels)}`,
    };
    const folder = timelineFolder.addFolder({ title: `${segment.index}. ${segment.label}`, expanded: false });
    folder.addBinding(info, 'type', { readonly: true, label: '类型' });
    folder.addBinding(info, 'route', { readonly: true, label: '路径' });
    folder.addBinding(info, 'duration', { readonly: true, label: '相对长度', format: (value) => value.toFixed(2) });
    folder.addBinding(info, 'start', { readonly: true, label: '起点', format: (value) => value.toFixed(3) });
    folder.addBinding(info, 'end', { readonly: true, label: '终点', format: (value) => value.toFixed(3) });
  }

  const transitionParams = opts.transition.getDebugParams();
  const transitionFolder = pane.addFolder({ title: '转场合成', expanded: false });
  transitionFolder
    .addBinding(transitionParams, 'chromaticStrength', { min: 0, max: 1.5, step: 0.01, label: '色散强度' })
    .on('change', (event) => opts.transition.setChromaticStrength(event.value));
  transitionFolder
    .addBinding(transitionParams, 'edgeSoftness', { min: 0.05, max: 3, step: 0.01, label: '边缘柔化' })
    .on('change', (event) => opts.transition.setEdgeSoftness(event.value));
  transitionFolder
    .addBinding(transitionParams, 'smearStrength', { min: 0, max: 2, step: 0.01, label: '拖影强度' })
    .on('change', (event) => opts.transition.setSmearStrength(event.value));
  transitionFolder
    .addBinding(transitionParams, 'smearLength', { min: 0, max: 0.35, step: 0.001, label: '拖影长度' })
    .on('change', (event) => opts.transition.setSmearLength(event.value));
  transitionFolder
    .addBinding(transitionParams, 'smearAngle', { min: -Math.PI, max: Math.PI, step: 0.01, label: '拖影角度' })
    .on('change', (event) => opts.transition.setSmearAngle(event.value));
  transitionFolder
    .addBinding(transitionParams, 'fogWashStrength', { min: 0, max: 1.5, step: 0.01, label: '雾化强度' })
    .on('change', (event) => opts.transition.setFogWashStrength(event.value));
  transitionFolder
    .addBinding(transitionParams, 'sceneBRevealStart', { min: 0, max: 0.95, step: 0.01, label: 'B 场景显现' })
    .on('change', (event) => opts.transition.setSceneBRevealStart(event.value));

  const cloudDebugTarget = opts.sections.find(isCloudDebugTarget);
  if (cloudDebugTarget) {
    const cloudParams = cloudDebugTarget.getCloudDebugParams();
    const cloudFolder = pane.addFolder({ title: '视频场景云海', expanded: false });
    const applyCloudDebug = () => cloudDebugTarget.applyCloudDebugParams(cloudParams);
    cloudFolder.addBinding(cloudParams, 'enabled', { label: '启用' }).on('change', applyCloudDebug);
    cloudFolder.addBinding(cloudParams, 'opacity', { min: 0, max: 1.5, step: 0.01, label: '总透明度' }).on('change', applyCloudDebug);
    cloudFolder.addBinding(cloudParams, 'fillOpacity', { min: 0, max: 1.5, step: 0.01, label: '主云透明度' }).on('change', applyCloudDebug);
    cloudFolder.addBinding(cloudParams, 'layerOpacity', { min: 0, max: 1.5, step: 0.01, label: '层云透明度' }).on('change', applyCloudDebug);
    cloudFolder.addBinding(cloudParams, 'foregroundOpacity', { min: 0, max: 1.5, step: 0.01, label: '前景透明度' }).on('change', applyCloudDebug);

    const cloudSpaceFolder = cloudFolder.addFolder({ title: '空间', expanded: false });
    cloudSpaceFolder.addBinding(cloudParams, 'fillCount', { min: 20, max: 260, step: 1, label: '主云数量' }).on('change', applyCloudDebug);
    cloudSpaceFolder.addBinding(cloudParams, 'width', { min: 200, max: 2200, step: 10, label: '横向铺开' }).on('change', applyCloudDebug);
    cloudSpaceFolder.addBinding(cloudParams, 'depth', { min: 120, max: 2200, step: 10, label: '纵深' }).on('change', applyCloudDebug);
    cloudSpaceFolder.addBinding(cloudParams, 'baseY', { min: -180, max: 80, step: 1, label: '基础高度' }).on('change', applyCloudDebug);
    cloudSpaceFolder.addBinding(cloudParams, 'fillScale', { min: 10, max: 180, step: 1, label: '云片尺寸' }).on('change', applyCloudDebug);
    cloudSpaceFolder.addBinding(cloudParams, 'randomScale', { min: 0, max: 100, step: 1, label: '随机尺寸' }).on('change', applyCloudDebug);
    cloudSpaceFolder.addBinding(cloudParams, 'cameraDrift', { min: -120, max: 120, step: 1, label: '相机拉动' }).on('change', applyCloudDebug);
    cloudSpaceFolder.addBinding(cloudParams, 'zDrift', { min: -300, max: 300, step: 1, label: '纵向漂移' }).on('change', applyCloudDebug);

    const cloudNoiseFolder = cloudFolder.addFolder({ title: '扰动', expanded: false });
    cloudNoiseFolder.addBinding(cloudParams, 'noiseStrength', { min: 0, max: 4, step: 0.01, label: '噪声强度' }).on('change', applyCloudDebug);
    cloudNoiseFolder.addBinding(cloudParams, 'noiseSpeed', { min: 0, max: 3, step: 0.01, label: '噪声速度' }).on('change', applyCloudDebug);
    cloudNoiseFolder.addBinding(cloudParams, 'alphaNoise', { min: 0, max: 2, step: 0.01, label: '透明扰动' }).on('change', applyCloudDebug);
    cloudNoiseFolder.addBinding(cloudParams, 'edgeSoftness', { min: 0.001, max: 0.5, step: 0.001, label: '边缘柔化' }).on('change', applyCloudDebug);

    const cloudColorFolder = cloudFolder.addFolder({ title: '颜色', expanded: false });
    cloudColorFolder.addBinding(cloudParams, 'brightness', { min: 0.2, max: 2.5, step: 0.01, label: '亮度' }).on('change', applyCloudDebug);
    cloudColorFolder.addBinding(cloudParams, 'tint', { label: '色调' }).on('change', applyCloudDebug);
    cloudColorFolder.addBinding(cloudParams, 'tintStrength', { min: 0, max: 1, step: 0.01, label: '色调强度' }).on('change', applyCloudDebug);

    const cloudTimingFolder = cloudFolder.addFolder({ title: '显隐', expanded: false });
    cloudTimingFolder.addBinding(cloudParams, 'enterStart', { min: 0, max: 1, step: 0.01, label: '进入开始' }).on('change', applyCloudDebug);
    cloudTimingFolder.addBinding(cloudParams, 'enterEnd', { min: 0, max: 1, step: 0.01, label: '进入结束' }).on('change', applyCloudDebug);
    cloudTimingFolder.addBinding(cloudParams, 'exitStart', { min: 0, max: 1, step: 0.01, label: '离开开始' }).on('change', applyCloudDebug);
    cloudTimingFolder.addBinding(cloudParams, 'exitEnd', { min: 0, max: 1, step: 0.01, label: '离开结束' }).on('change', applyCloudDebug);
  }

  const backdropParams = {
    color1: '#aebdcd',
    color2: '#edf4f8',
    dotStrength: 1,
    blueNoiseStrength: 0.018,
    centerGlowStrength: 0.5,
  };
  const backdropFolder = pane.addFolder({ title: '共享背景', expanded: false });
  backdropFolder.addBinding(backdropParams, 'color1', { label: '颜色 1' }).on('change', (event) => opts.backdrop.setColor1(event.value));
  backdropFolder.addBinding(backdropParams, 'color2', { label: '颜色 2' }).on('change', (event) => opts.backdrop.setColor2(event.value));
  backdropFolder.addBinding(backdropParams, 'dotStrength', { min: 0, max: 2, step: 0.01, label: '点阵强度' }).on('change', (event) => opts.backdrop.setDotStrength(event.value));
  backdropFolder.addBinding(backdropParams, 'blueNoiseStrength', { min: 0, max: 0.15, step: 0.001, label: '蓝噪强度' }).on('change', (event) => opts.backdrop.setBlueNoiseStrength(event.value));
  backdropFolder.addBinding(backdropParams, 'centerGlowStrength', { min: 0, max: 1, step: 0.01, label: '中心光' }).on('change', (event) => opts.backdrop.setCenterGlowStrength(event.value));

  const engineFolder = pane.addFolder({ title: '渲染引擎', expanded: false });
  engineFolder.addButton({ title: '暂停' }).on('click', () => opts.engine.stop());
  engineFolder.addButton({ title: '继续' }).on('click', () => opts.engine.start());

  const sceneFolder = pane.addFolder({ title: '场景信息', expanded: false });
  for (const scene of opts.sections) {
    const info = {
      name: sceneLabels.get(scene.name) ?? scene.name,
      id: scene.name,
      camera: scene.camera.type,
    };
    const folder = sceneFolder.addFolder({ title: info.name, expanded: false });
    folder.addBinding(info, 'name', { readonly: true, label: '显示名' });
    folder.addBinding(info, 'id', { readonly: true, label: '场景标识' });
    folder.addBinding(info, 'camera', { readonly: true, label: '相机类型' });
  }

  let visible = true;
  const setVisible = (next: boolean) => {
    visible = next;
    container.style.display = visible ? 'block' : 'none';
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (shouldIgnoreToggle(event)) return;
    if (event.key.toLowerCase() === 'd') {
      setVisible(!visible);
    }
  };
  window.addEventListener('keydown', onKeydown);

  let lastRefresh = 0;

  return {
    update(frame, scrollState) {
      runtime.progress = scrollState.progress;
      runtime.velocity = scrollState.velocity;
      runtime.rawVelocity = scrollState.rawVelocity;
      runtime.direction = scrollState.direction;
      runtime.segmentType = isTransitionSegment(frame.activeSegment) ? '转场段' : '场景段';
      runtime.activeSegment = frame.activeSegment.label;
      runtime.currentScene = getSceneDisplayName(frame.current.name, sceneLabels);
      runtime.nextScene = getSceneDisplayName(frame.next.name, sceneLabels);
      runtime.segmentProgress = frame.segmentProgress;
      runtime.sceneProgress = frame.sceneProgress;
      runtime.transitionProgress = frame.transitionProgress;
      runtime.mix = frame.mix;

      const now = performance.now();
      if (visible && now - lastRefresh > 100) {
        pane.refresh();
        lastRefresh = now;
      }
    },
    destroy() {
      window.removeEventListener('keydown', onKeydown);
      pane.dispose();
      container.remove();
    },
  };
}
