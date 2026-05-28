import { Pane } from 'tweakpane';
import type { Engine } from '../core/Engine';
import type { SharedBackdrop } from '../render/SharedBackdrop';
import type { TransitionRenderer } from '../runtime/TransitionRenderer';
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
import { isScene3DebugScene } from '../scenes/Scene3CityScene';

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
    expanded: false,
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

  const runtimeFolder = pane.addFolder({ title: '运行状态', expanded: false });
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

    const earthFolder = pane.addFolder({ title: 'Earth 调试', expanded: false });

    const earthMaterials = earthFolder.addFolder({ title: '材质', expanded: false });
    earthMaterials.addBinding(earthDebug.materials, 'textColor', { label: '文字颜色' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'textOpacity', { min: 0, max: 1.5, step: 0.01, label: '文字透明度' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'ringColor', { label: '环颜色' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'ringOpacity', { min: 0, max: 1, step: 0.01, label: '环透明度' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'ringTexturePanelOpacity', { min: 0, max: 1, step: 0.01, label: '贴图底板透明度' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'ringTexture1Opacity', { min: 0, max: 1, step: 0.01, label: '条纹贴图透明度' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'ringTexture1Brightness', { min: 0, max: 4, step: 0.01, label: '条纹贴图亮度' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'ringTexture2Opacity', { min: 0, max: 1, step: 0.01, label: '图片贴图透明度' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'ringTexture2Brightness', { min: 0, max: 4, step: 0.01, label: '图片贴图亮度' }).on('change', applyEarthDebug);
    const earthTextureUv = earthMaterials.addFolder({ title: '环贴图 UV', expanded: false });
    const earthTextureFace3Uv = earthTextureUv.addFolder({ title: 'face3 条纹 1.png', expanded: false });
    earthTextureFace3Uv.addBinding(earthDebug.materials, 'ringTextureFace3Visible', { label: '显示贴图' }).on('change', applyEarthDebug);
    earthTextureFace3Uv.addBinding(earthDebug.materials, 'ringTextureFace3UvFitEnabled', { label: '铺满面片' }).on('change', applyEarthDebug);
    earthTextureFace3Uv.addBinding(earthDebug.materials, 'ringTextureFace3UvOffsetX', { min: -1, max: 1, step: 0.001, label: '偏移 X' }).on('change', applyEarthDebug);
    earthTextureFace3Uv.addBinding(earthDebug.materials, 'ringTextureFace3UvOffsetY', { min: -1, max: 1, step: 0.001, label: '偏移 Y' }).on('change', applyEarthDebug);
    earthTextureFace3Uv.addBinding(earthDebug.materials, 'ringTextureFace3UvScaleX', { min: 0.05, max: 8, step: 0.001, label: '缩放 X' }).on('change', applyEarthDebug);
    earthTextureFace3Uv.addBinding(earthDebug.materials, 'ringTextureFace3UvScaleY', { min: 0.05, max: 8, step: 0.001, label: '缩放 Y' }).on('change', applyEarthDebug);
    earthTextureFace3Uv.addBinding(earthDebug.materials, 'ringTextureFace3UvRotation', { min: -Math.PI, max: Math.PI, step: 0.001, label: '旋转' }).on('change', applyEarthDebug);
    earthTextureFace3Uv.addBinding(earthDebug.materials, 'ringTextureFace3UvFlipX', { label: '翻转 X' }).on('change', applyEarthDebug);
    earthTextureFace3Uv.addBinding(earthDebug.materials, 'ringTextureFace3UvFlipY', { label: '翻转 Y' }).on('change', applyEarthDebug);
    earthTextureFace3Uv.addBinding(earthDebug.materials, 'ringTextureFace3UvSwap', { label: '交换 XY' }).on('change', applyEarthDebug);
    const earthTextureFace8Uv = earthTextureUv.addFolder({ title: 'face8 图片 2.png', expanded: false });
    earthTextureFace8Uv.addBinding(earthDebug.materials, 'ringTextureFace8Visible', { label: '显示贴图' }).on('change', applyEarthDebug);
    earthTextureFace8Uv.addBinding(earthDebug.materials, 'ringTextureFace8UvFitEnabled', { label: '铺满面片' }).on('change', applyEarthDebug);
    earthTextureFace8Uv.addBinding(earthDebug.materials, 'ringTextureFace8UvOffsetX', { min: -1, max: 1, step: 0.001, label: '偏移 X' }).on('change', applyEarthDebug);
    earthTextureFace8Uv.addBinding(earthDebug.materials, 'ringTextureFace8UvOffsetY', { min: -1, max: 1, step: 0.001, label: '偏移 Y' }).on('change', applyEarthDebug);
    earthTextureFace8Uv.addBinding(earthDebug.materials, 'ringTextureFace8UvScaleX', { min: 0.05, max: 8, step: 0.001, label: '缩放 X' }).on('change', applyEarthDebug);
    earthTextureFace8Uv.addBinding(earthDebug.materials, 'ringTextureFace8UvScaleY', { min: 0.05, max: 8, step: 0.001, label: '缩放 Y' }).on('change', applyEarthDebug);
    earthTextureFace8Uv.addBinding(earthDebug.materials, 'ringTextureFace8UvRotation', { min: -Math.PI, max: Math.PI, step: 0.001, label: '旋转' }).on('change', applyEarthDebug);
    earthTextureFace8Uv.addBinding(earthDebug.materials, 'ringTextureFace8UvFlipX', { label: '翻转 X' }).on('change', applyEarthDebug);
    earthTextureFace8Uv.addBinding(earthDebug.materials, 'ringTextureFace8UvFlipY', { label: '翻转 Y' }).on('change', applyEarthDebug);
    earthTextureFace8Uv.addBinding(earthDebug.materials, 'ringTextureFace8UvSwap', { label: '交换 XY' }).on('change', applyEarthDebug);
    const earthTextureFace9Uv = earthTextureUv.addFolder({ title: 'face9 条纹 1.png', expanded: false });
    earthTextureFace9Uv.addBinding(earthDebug.materials, 'ringTextureFace9Visible', { label: '显示贴图' }).on('change', applyEarthDebug);
    earthTextureFace9Uv.addBinding(earthDebug.materials, 'ringTextureFace9UvFitEnabled', { label: '铺满面片' }).on('change', applyEarthDebug);
    earthTextureFace9Uv.addBinding(earthDebug.materials, 'ringTextureFace9UvOffsetX', { min: -1, max: 1, step: 0.001, label: '偏移 X' }).on('change', applyEarthDebug);
    earthTextureFace9Uv.addBinding(earthDebug.materials, 'ringTextureFace9UvOffsetY', { min: -1, max: 1, step: 0.001, label: '偏移 Y' }).on('change', applyEarthDebug);
    earthTextureFace9Uv.addBinding(earthDebug.materials, 'ringTextureFace9UvScaleX', { min: 0.05, max: 8, step: 0.001, label: '缩放 X' }).on('change', applyEarthDebug);
    earthTextureFace9Uv.addBinding(earthDebug.materials, 'ringTextureFace9UvScaleY', { min: 0.05, max: 8, step: 0.001, label: '缩放 Y' }).on('change', applyEarthDebug);
    earthTextureFace9Uv.addBinding(earthDebug.materials, 'ringTextureFace9UvRotation', { min: -Math.PI, max: Math.PI, step: 0.001, label: '旋转' }).on('change', applyEarthDebug);
    earthTextureFace9Uv.addBinding(earthDebug.materials, 'ringTextureFace9UvFlipX', { label: '翻转 X' }).on('change', applyEarthDebug);
    earthTextureFace9Uv.addBinding(earthDebug.materials, 'ringTextureFace9UvFlipY', { label: '翻转 Y' }).on('change', applyEarthDebug);
    earthTextureFace9Uv.addBinding(earthDebug.materials, 'ringTextureFace9UvSwap', { label: '交换 XY' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'ringEmissiveColor', { label: '环发光色' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'ringEmissiveIntensity', { min: 0, max: 3, step: 0.01, label: '环发光' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'sideColor', { label: '侧面颜色' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'sideOpacity', { min: 0, max: 1, step: 0.01, label: '侧面透明度' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'sideEmissiveColor', { label: '侧面发光色' }).on('change', applyEarthDebug);
    earthMaterials.addBinding(earthDebug.materials, 'sideEmissiveIntensity', { min: 0, max: 3, step: 0.01, label: '侧面发光' }).on('change', applyEarthDebug);

    const ringMotion = earthFolder.addFolder({ title: '环/文字运动', expanded: false });
    ringMotion.addBinding(earthDebug.motion.ring, 'autoRotateEnabled', { label: '自动旋转' }).on('change', applyEarthDebug);
    ringMotion.addBinding(earthDebug.motion.ring, 'autoRotateSpeed', { min: -0.4, max: 0.4, step: 0.001, label: '旋转速度' }).on('change', applyEarthDebug);
    ringMotion.addBinding(earthDebug.motion.ring, 'initialRotationY', { min: -Math.PI, max: Math.PI, step: 0.001, label: '初始角度 Y' }).on('change', applyEarthDebug);
    ringMotion.addBinding(earthDebug.uiTransform, 'offsetX', { min: -1, max: 1, step: 0.001, label: '整体偏移 X' }).on('change', applyEarthDebug);
    ringMotion.addBinding(earthDebug.uiTransform, 'offsetY', { min: -1, max: 1, step: 0.001, label: '整体偏移 Y' }).on('change', applyEarthDebug);
    ringMotion.addBinding(earthDebug.uiTransform, 'offsetZ', { min: -1, max: 1, step: 0.001, label: '整体偏移 Z' }).on('change', applyEarthDebug);
    ringMotion.addBinding(earthDebug.uiTransform, 'scale', { min: 0.2, max: 2, step: 0.001, label: '整体缩放' }).on('change', applyEarthDebug);

    const earthRingLayers = earthFolder.addFolder({ title: '环分层旋转', expanded: false });
    earthRingLayers.addBinding(earthDebug.motion.ringLayers, 'enabled', { label: '启用分层' }).on('change', applyEarthDebug);
    const addRingLayerBindings = (
      title: string,
      layer: typeof earthDebug.motion.ringLayers.inner,
    ) => {
      const folder = earthRingLayers.addFolder({ title, expanded: false });
      folder.addBinding(layer, 'autoRotateEnabled', { label: '自动旋转' }).on('change', applyEarthDebug);
      folder.addBinding(layer, 'autoRotateSpeed', { min: -0.5, max: 0.5, step: 0.001, label: '相对速度' }).on('change', applyEarthDebug);
      folder.addBinding(layer, 'initialRotationY', { min: -Math.PI, max: Math.PI, step: 0.001, label: '相位 Y' }).on('change', applyEarthDebug);
    };
    addRingLayerBindings('内环', earthDebug.motion.ringLayers.inner);
    addRingLayerBindings('中环', earthDebug.motion.ringLayers.middle);
    addRingLayerBindings('外环', earthDebug.motion.ringLayers.outer);

    const earthMotion = earthFolder.addFolder({ title: '地球运动', expanded: false });
    earthMotion.addBinding(earthDebug.motion.earth, 'autoRotateEnabled', { label: '自动旋转' }).on('change', applyEarthDebug);
    earthMotion.addBinding(earthDebug.motion.earth, 'autoRotateSpeed', { min: -0.4, max: 0.4, step: 0.001, label: '旋转速度' }).on('change', applyEarthDebug);
    earthMotion.addBinding(earthDebug.motion.earth, 'initialRotationY', { min: -Math.PI, max: Math.PI, step: 0.001, label: '初始角度 Y' }).on('change', applyEarthDebug);
    earthMotion.addBinding(earthDebug.earthTransform, 'scale', { min: 0.2, max: 2, step: 0.001, label: '整体缩放' }).on('change', applyEarthDebug);

    const earthBottomHud = earthFolder.addFolder({ title: '底部 HUD', expanded: false });
    earthBottomHud.addBinding(earthDebug.bottomHud, 'visible', { label: '显示' }).on('change', applyEarthDebug);
    earthBottomHud.addBinding(earthDebug.bottomHud, 'opacity', { min: 0, max: 1, step: 0.01, label: '透明度' }).on('change', applyEarthDebug);
    earthBottomHud.addBinding(earthDebug.bottomHud, 'color', { label: '颜色' }).on('change', applyEarthDebug);
    earthBottomHud.addBinding(earthDebug.bottomHud, 'brightness', { min: 0, max: 4, step: 0.01, label: '亮度' }).on('change', applyEarthDebug);
    earthBottomHud.addBinding(earthDebug.bottomHud, 'scale', { min: 0.2, max: 3, step: 0.01, label: '缩放' }).on('change', applyEarthDebug);
    earthBottomHud.addBinding(earthDebug.bottomHud, 'tiltDeg', { min: -120, max: -35, step: 0.1, label: '倾斜角度' }).on('change', applyEarthDebug);
    earthBottomHud.addBinding(earthDebug.bottomHud, 'positionY', { min: -2, max: 0.5, step: 0.01, label: '高度 Y' }).on('change', applyEarthDebug);
    earthBottomHud.addBinding(earthDebug.bottomHud, 'positionZ', { min: -8, max: 2, step: 0.01, label: '前后 Z' }).on('change', applyEarthDebug);
    earthBottomHud.addBinding(earthDebug.bottomHud, 'speed', { min: -4, max: 4, step: 0.01, label: '旋转倍率' }).on('change', applyEarthDebug);

    const earthRingEdge = earthFolder.addFolder({ title: '环边框', expanded: false });
    earthRingEdge.addBinding(earthDebug.ringEdge, 'visible', { label: '显示边框' }).on('change', applyEarthDebug);
    earthRingEdge.addBinding(earthDebug.ringEdge, 'color', { label: '边框颜色' }).on('change', applyEarthDebug);
    earthRingEdge.addBinding(earthDebug.ringEdge, 'opacity', { min: 0, max: 1.5, step: 0.01, label: '边框透明度' }).on('change', applyEarthDebug);
    earthRingEdge.addBinding(earthDebug.ringEdge, 'lineWidth', { min: 0.2, max: 8, step: 0.1, label: '边框线宽' }).on('change', applyEarthDebug);

    const earthPost = earthFolder.addFolder({ title: '地球后处理', expanded: false });
    earthPost.addBinding(earthDebug.post, 'enabled', { label: '启用' }).on('change', applyEarthDebug);
    earthPost.addBinding(earthDebug.post, 'exposure', { min: 0, max: 3, step: 0.01, label: '映射强度' }).on('change', applyEarthDebug);
    earthPost.addBinding(earthDebug.post, 'toneMappingMode', {
      label: '映射类型',
      options: {
        Linear: 'LINEAR',
        Reinhard: 'REINHARD',
        Reinhard2: 'REINHARD2',
        Uncharted2: 'UNCHARTED2',
        Cineon: 'CINEON',
        ACES: 'ACES_FILMIC',
        AgX: 'AGX',
        Neutral: 'NEUTRAL',
      },
    }).on('change', applyEarthDebug);

    const earthGlobe = earthFolder.addFolder({ title: '地球材质', expanded: false });
    earthGlobe.addBinding(earthDebug.globe, 'bumpScale', { min: 0, max: 0.08, step: 0.0005, label: '凹凸强度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'normalScale', { min: 0, max: 2.5, step: 0.01, label: '法线强度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'dayBrightness', { min: 0.6, max: 1.6, step: 0.01, label: '白天地表亮度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'daySaturation', { min: 0, max: 1.5, step: 0.01, label: '白天地表饱和' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'oceanLift', { min: 0, max: 1, step: 0.01, label: '海洋提亮偏青' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'oceanCyanShift', { min: 0, max: 1, step: 0.01, label: '海洋偏青' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'landLift', { min: 0, max: 1, step: 0.01, label: '陆地提亮柔化' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'landDeYellow', { min: 0, max: 1, step: 0.01, label: '陆地去黄' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'vegetationBoost', { min: 0, max: 1, step: 0.01, label: '植被增绿' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'hazeStrength', { min: 0, max: 1, step: 0.01, label: '前向雾化' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudLow', { min: 0, max: 1, step: 0.001, label: '云层低阈值' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudHigh', { min: 0, max: 1, step: 0.001, label: '云层高阈值' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudOpacity', { min: 0, max: 1.5, step: 0.001, label: '云层透明度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudBrightness', { min: 0.5, max: 1.8, step: 0.01, label: '云层亮度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudColor', { label: '云层颜色' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudMotionEnabled', { label: '云场动画' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudFlowSpeed', { min: 0, max: 0.08, step: 0.001, label: '云流速' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudWarpStrength', { min: 0, max: 0.08, step: 0.001, label: '内部扰动' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudDetailStrength', { min: 0, max: 1, step: 0.01, label: '细节流动' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudEdgeMotion', { min: 0, max: 1, step: 0.01, label: '边缘变化' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'oceanRoughness', { min: 0, max: 1, step: 0.001, label: '海面粗糙度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'landRoughness', { min: 0, max: 1, step: 0.001, label: '陆地粗糙度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'cloudRoughness', { min: 0, max: 1, step: 0.001, label: '云层粗糙度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'oceanSpecStrength', { min: 0, max: 3, step: 0.01, label: '海面高光强度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'oceanFresnelStrength', { min: 0, max: 2, step: 0.01, label: '海面边缘反射' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'nightIntensity', { min: 0, max: 8, step: 0.01, label: '夜景强度' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'nightFadeStart', { min: 0, max: 1, step: 0.01, label: '夜景开始显现' }).on('change', applyEarthDebug);
    earthGlobe.addBinding(earthDebug.globe, 'nightFadeEnd', { min: -1, max: 0.5, step: 0.01, label: '夜景完全显现' }).on('change', applyEarthDebug);

    const earthAtmosphere = earthFolder.addFolder({ title: '大气', expanded: false });
    earthAtmosphere.addBinding(earthDebug.atmosphere, 'atmosphereDayColor', { label: '日侧大气色' }).on('change', applyEarthDebug);
    earthAtmosphere.addBinding(earthDebug.atmosphere, 'atmosphereTwilightColor', { label: '暮光大气色' }).on('change', applyEarthDebug);
    earthAtmosphere.addBinding(earthDebug.atmosphere, 'atmosphereStrength', { min: 0, max: 1.5, step: 0.01, label: '大气强度' }).on('change', applyEarthDebug);
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

  const scene3Scene = opts.sections.find(isScene3DebugScene);
  if (scene3Scene) {
    const scene3Debug = scene3Scene.getScene3DebugData();
    const applyScene3Debug = () => scene3Scene.applyScene3Debug();

    const scene3Folder = pane.addFolder({ title: 'Scene3 调试', expanded: false });

    const scene3Materials = scene3Folder.addFolder({ title: '材质', expanded: false });
    scene3Materials.addBinding(scene3Debug.materials, 'windowColor', { label: '窗户颜色' }).on('change', applyScene3Debug);
    scene3Materials.addBinding(scene3Debug.materials, 'windowOpacity', { min: 0, max: 1, step: 0.01, label: '窗户透明度' }).on('change', applyScene3Debug);
    scene3Materials.addBinding(scene3Debug.materials, 'windowEmissiveColor', { label: '窗户发光色' }).on('change', applyScene3Debug);
    scene3Materials.addBinding(scene3Debug.materials, 'windowEmissiveIntensity', { min: 0, max: 3, step: 0.01, label: '窗户发光' }).on('change', applyScene3Debug);
    scene3Materials.addBinding(scene3Debug.materials, 'windowRoughness', { min: 0, max: 1, step: 0.01, label: '窗户粗糙度' }).on('change', applyScene3Debug);
    scene3Materials.addBinding(scene3Debug.materials, 'bodyColor', { label: '主体颜色' }).on('change', applyScene3Debug);
    scene3Materials.addBinding(scene3Debug.materials, 'bodyOpacity', { min: 0, max: 1, step: 0.01, label: '主体透明度' }).on('change', applyScene3Debug);
    scene3Materials.addBinding(scene3Debug.materials, 'bodyEmissiveColor', { label: '主体发光色' }).on('change', applyScene3Debug);
    scene3Materials.addBinding(scene3Debug.materials, 'bodyEmissiveIntensity', { min: 0, max: 2, step: 0.01, label: '主体发光' }).on('change', applyScene3Debug);
    scene3Materials.addBinding(scene3Debug.materials, 'bodyMetalness', { min: 0, max: 1, step: 0.01, label: '主体金属度' }).on('change', applyScene3Debug);
    scene3Materials.addBinding(scene3Debug.materials, 'bodyRoughness', { min: 0, max: 1, step: 0.01, label: '主体粗糙度' }).on('change', applyScene3Debug);

    const scene3Lighting = scene3Folder.addFolder({ title: '环境光照', expanded: false });
    scene3Lighting.addBinding(scene3Debug.lighting, 'environmentIntensity', { min: 0, max: 3, step: 0.01, label: '环境反射' }).on('change', applyScene3Debug);
    scene3Lighting.addBinding(scene3Debug.lighting, 'ambientIntensity', { min: 0, max: 1.5, step: 0.01, label: '环境光' }).on('change', applyScene3Debug);
    scene3Lighting.addBinding(scene3Debug.lighting, 'keyIntensity', { min: 0, max: 5, step: 0.01, label: '主光' }).on('change', applyScene3Debug);
    scene3Lighting.addBinding(scene3Debug.lighting, 'fillIntensity', { min: 0, max: 3, step: 0.01, label: '补光' }).on('change', applyScene3Debug);
    scene3Lighting.addBinding(scene3Debug.lighting, 'rimIntensity', { min: 0, max: 5, step: 0.01, label: '轮廓光' }).on('change', applyScene3Debug);
    scene3Lighting.addBinding(scene3Debug.lighting, 'shadowsEnabled', { label: '阴影' }).on('change', applyScene3Debug);

    const scene3Post = scene3Folder.addFolder({ title: 'Scene3 后处理', expanded: false });
    scene3Post.addBinding(scene3Debug.post, 'enabled', { label: '启用' }).on('change', applyScene3Debug);
    scene3Post.addBinding(scene3Debug.post, 'exposure', { min: 0, max: 3, step: 0.01, label: '映射强度' }).on('change', applyScene3Debug);
    scene3Post.addBinding(scene3Debug.post, 'toneMappingMode', {
      label: '映射类型',
      options: {
        Linear: 'LINEAR',
        Reinhard: 'REINHARD',
        Reinhard2: 'REINHARD2',
        Uncharted2: 'UNCHARTED2',
        Cineon: 'CINEON',
        ACES: 'ACES_FILMIC',
        AgX: 'AGX',
        Neutral: 'NEUTRAL',
      },
    }).on('change', applyScene3Debug);

    const scene3Stage = scene3Folder.addFolder({ title: '整体位置', expanded: false });
    scene3Stage.addBinding(scene3Debug.stage, 'positionX', { min: -3, max: 3, step: 0.01, label: '位置 X' }).on('change', applyScene3Debug);
    scene3Stage.addBinding(scene3Debug.stage, 'positionY', { min: -1, max: 3, step: 0.01, label: '位置 Y' }).on('change', applyScene3Debug);
    scene3Stage.addBinding(scene3Debug.stage, 'positionZ', { min: -3, max: 3, step: 0.01, label: '位置 Z' }).on('change', applyScene3Debug);
    scene3Stage.addBinding(scene3Debug.stage, 'rotationY', { min: -Math.PI, max: Math.PI, step: 0.001, label: '旋转 Y' }).on('change', applyScene3Debug);
    scene3Stage.addBinding(scene3Debug.stage, 'scale', { min: 0.2, max: 2, step: 0.01, label: '缩放' }).on('change', applyScene3Debug);

    const scene3Bounds = scene3Folder.addFolder({ title: '包围盒', expanded: true });
    scene3Bounds.addBinding(scene3Debug.bounds, 'visible', { label: '显示包围盒' }).on('change', applyScene3Debug);
    scene3Bounds.addBinding(scene3Debug.bounds, 'color', { label: '颜色' }).on('change', applyScene3Debug);
    scene3Bounds.addBinding(scene3Debug.bounds, 'opacity', { min: 0, max: 1, step: 0.01, label: '透明度' }).on('change', applyScene3Debug);

    const scene3VideoCards = scene3Folder.addFolder({ title: '视频卡片', expanded: true });
    const addVideoCardBindings = (
      title: string,
      card: typeof scene3Debug.videoCards.left,
    ) => {
      const folder = scene3VideoCards.addFolder({ title, expanded: false });
      folder.addBinding(card, 'visible', { label: '显示' }).on('change', applyScene3Debug);
      folder.addBinding(card, 'opacity', { min: 0, max: 1, step: 0.01, label: '透明度' }).on('change', applyScene3Debug);
      folder.addBinding(card, 'offsetX', { min: -50, max: 50, step: 0.1, label: '偏移 X' }).on('change', applyScene3Debug);
      folder.addBinding(card, 'offsetY', { min: -50, max: 50, step: 0.1, label: '偏移 Y' }).on('change', applyScene3Debug);
      folder.addBinding(card, 'offsetZ', { min: -50, max: 50, step: 0.1, label: '偏移 Z' }).on('change', applyScene3Debug);
      folder.addBinding(card, 'rotationXDeg', { min: -90, max: 90, step: 1, label: '旋转 X' }).on('change', applyScene3Debug);
      folder.addBinding(card, 'rotationYDeg', { min: -180, max: 180, step: 1, label: '旋转 Y' }).on('change', applyScene3Debug);
      folder.addBinding(card, 'rotationZDeg', { min: -90, max: 90, step: 1, label: '旋转 Z' }).on('change', applyScene3Debug);
      folder.addBinding(card, 'scale', { min: 0.1, max: 2, step: 0.01, label: '缩放' }).on('change', applyScene3Debug);
    };
    addVideoCardBindings('左卡片', scene3Debug.videoCards.left);
    addVideoCardBindings('右卡片', scene3Debug.videoCards.right);

    const scene3Drone = scene3Folder.addFolder({ title: '无人机整体', expanded: false });
    scene3Drone.addBinding(scene3Debug.drone, 'scale', { min: 0.1, max: 5, step: 0.01, label: '缩放' }).on('change', applyScene3Debug);
    scene3Drone.addBinding(scene3Debug.drone, 'positionX', { min: -1000, max: 1000, step: 1, label: '位置 X' }).on('change', applyScene3Debug);
    scene3Drone.addBinding(scene3Debug.drone, 'positionY', { min: -1000, max: 1200, step: 1, label: '位置 Y' }).on('change', applyScene3Debug);
    scene3Drone.addBinding(scene3Debug.drone, 'positionZ', { min: -1000, max: 1000, step: 1, label: '位置 Z' }).on('change', applyScene3Debug);
    scene3Drone.addBinding(scene3Debug.drone, 'rotationYDeg', { min: -360, max: 360, step: 1, label: '旋转 Y' }).on('change', applyScene3Debug);

    scene3Folder.addButton({ title: '重置 Scene3 参数' }).on('click', () => {
      scene3Scene.resetScene3Debug();
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

  const backdropParams = {
    color1: '#bdc1d8',
    color2: '#7c818c',
    dotStrength: 2,
    blueNoiseStrength: 0.042,
    centerGlowStrength: 0.37,
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
