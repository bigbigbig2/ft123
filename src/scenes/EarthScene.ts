import * as THREE from 'three';
import { ModelScene } from './ModelScene';
import type { SceneBase, SceneScrollState } from './SceneBase';
import { createProceduralEarth } from './earth/createEarthModel';
import {
  DEFAULT_EARTH_TIMELINE_CONFIG,
  getEarthTimeline,
  type EarthTimeline,
} from './earth/earthTimeline';
import { moveBoxCenterTo, normalizeText, setMaterial } from './earth/earthSceneUtils';
import { loadGLTF } from '../utils/loaders';

const EARTH_MODEL_ROOT = '/models/%E5%9C%B0%E7%90%83%E9%A1%B5%E9%9D%A2%E6%A8%A1%E5%9E%8B';

/** 鍒涘缓瑁呴グ鐜殑鏉愯川锛氫娇鐢?PhysicalMaterial 妯℃嫙閫忔槑鍙戝厜璐ㄦ劅 */
function createRingMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: '#d8fbff',
    emissive: '#8ff8ff',
    emissiveIntensity: 0.26,
    transmission: 0.7, // 寮€鍚€忓厜鎬?
    thickness: 0.08,
    transparent: true,
    opacity: 0.14,
    roughness: 0.08,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false, // 鍏抽棴娣卞害鍐欏叆锛岄槻姝㈠崐閫忔槑閬尅鍐茬獊
  });
}

function colorToHex(color: THREE.Color) {
  return `#${color.getHexString()}`;
}

function normalizeSunDirection(x: number, y: number, z: number) {
  const dir = new THREE.Vector3(x, y, z);
  if (dir.lengthSq() < 0.000001) return new THREE.Vector3(0.536, 0.343, 0.772).normalize();
  return dir.normalize();
}

function createLightState(light: THREE.Light): EarthDebugSingleLightState {
  return {
    enabled: light.visible,
    color: colorToHex(light.color),
    intensity: light.intensity,
  };
}

function applyLightState(light: THREE.Light, state: EarthDebugSingleLightState) {
  light.visible = state.enabled;
  light.color.set(state.color);
  light.intensity = state.intensity;
}

function cloneDebugData<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

function assignDebugData<T extends Record<string, unknown>>(target: T, source: T) {
  for (const key of Object.keys(source) as Array<keyof T>) {
    const value = source[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      Object.assign(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

export interface EarthDebugStageState {
  forceRingVisible: boolean;
  forceTextVisible: boolean;
  ringYOffsetStart: number;
  ringYOffsetEnd: number;
  textYOffsetStart: number;
  textYOffsetEnd: number;
  ringScaleStart: number;
  ringScaleEnd: number;
  textScaleStart: number;
  textScaleEnd: number;
  textOpacityMax: number;
  ringOpacityBase: number;
  ringEmissiveBase: number;
}

export interface EarthDebugGlobeState {
  bumpScale: number;
  normalScale: number;
  dayBrightness: number;
  daySaturation: number;
  oceanLift: number;
  oceanCyanShift: number;
  landLift: number;
  landDeYellow: number;
  vegetationBoost: number;
  hazeStrength: number;
  cloudLow: number;
  cloudHigh: number;
  cloudOpacity: number;
  cloudBrightness: number;
  cloudColor: string;
  oceanRoughness: number;
  landRoughness: number;
  cloudRoughness: number;
  oceanSpecStrength: number;
  oceanFresnelStrength: number;
  nightIntensity: number;
  nightFadeStart: number;
  nightFadeEnd: number;
}

export interface EarthDebugAtmosphereState {
  atmosphereDayColor: string;
  atmosphereTwilightColor: string;
  atmosphereStrength: number;
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
  atmosphereScale: number;
}

export interface EarthDebugSingleLightState {
  enabled: boolean;
  color: string;
  intensity: number;
}

export interface EarthDebugLightState {
  ambient: EarthDebugSingleLightState;
  key: EarthDebugSingleLightState;
  fill: EarthDebugSingleLightState;
  sun: EarthDebugSingleLightState;
}

export interface EarthDebugData {
  stage: EarthDebugStageState;
  globe: EarthDebugGlobeState;
  atmosphere: EarthDebugAtmosphereState;
  lights: EarthDebugLightState;
}

export interface EarthSceneDebugControls {
  getEarthDebugData(): EarthDebugData;
  applyEarthDebug(): void;
  resetEarthDebug(): void;
}

export function isEarthDebugScene(scene: SceneBase): scene is SceneBase & EarthSceneDebugControls {
  return (
    typeof (scene as Partial<EarthSceneDebugControls>).getEarthDebugData === 'function' &&
    typeof (scene as Partial<EarthSceneDebugControls>).applyEarthDebug === 'function' &&
    typeof (scene as Partial<EarthSceneDebugControls>).resetEarthDebug === 'function'
  );
}

function createFallbackScrollState(): SceneScrollState {
  return {
    role: 'current',
    sceneIndex: 0,
    local: 1,
    focus: 1,
    enter: 1,
    leave: 0,
    segmentProgress: 1,
    transitionProgress: 0,
    velocity: 0,
    direction: 1,
  };
}

/**
 * createEarthScene: 鏋勫缓鍦扮悆鍦烘櫙鐨勬牳蹇冩柟娉曘€?
 * 
 * 鏍稿績閫昏緫锛?
 * 1. 寮傛鍔犺浇 3D 妯″瀷锛氬湴鐞冿紙绋嬪簭鐢熸垚锛夈€佽楗扮幆銆佹枃瀛椼€?
 * 2. 鍦烘櫙甯冨眬锛氭墜鍔ㄨ皟鏁存ā鍨嬩綅缃€佺缉鏀惧拰鍏夌収銆?
 * 3. 鍔ㄧ敾椹卞姩锛氶€氳繃鎷︽埅 setScrollState锛屽皢婊氬姩杩涘害瑙ｆ瀽涓哄缁村害鐨勫姩鐢绘椂闂寸嚎 (EarthTimeline)銆?
 */
export async function createEarthScene() {
  const scene = new ModelScene({
    name: 'earth',
    fov: 31,
    cameraPosition: [0, 0.35, 4.25],
    cameraLookAt: [0, 0.02, 0],
    autoRotateSpeed: 0.045,
  });

  // 1. 骞跺彂鍔犺浇鎵€鏈夎祫婧?
  const [earth, ring, text] = await Promise.all([
    createProceduralEarth(), // 绋嬪簭鍖栫敓鎴愮殑鍦扮悆锛堝寘鍚珮绾?Shader 鏉愯川锛?
    loadGLTF(`${EARTH_MODEL_ROOT}/huan.gltf`),
    loadGLTF(`${EARTH_MODEL_ROOT}/wenzi.gltf`),
  ]);

  // 2. 鐏厜璋冩暣锛氱Щ闄ら粯璁ゅ厜鐓э紝娣诲姞鏍规嵁鍦扮悆澶槼鏂瑰悜鍚屾鐨勫钩琛屽厜
  const hemiLight = scene.scene.children.find((child) => child instanceof THREE.HemisphereLight);
  if (hemiLight) scene.scene.remove(hemiLight);

  const ambientLight = scene.scene.children.find((child) => child instanceof THREE.AmbientLight) as THREE.AmbientLight | undefined;
  const [keyLight, fillLight] = scene.scene.children.filter((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight[];

  if (ambientLight) {
    ambientLight.intensity = 0.62;
    ambientLight.color.set('#dbe7f4');
  }
  if (keyLight) {
    keyLight.intensity = 1.1;
    keyLight.color.set('#f5f8ff');
  }
  if (fillLight) {
    fillLight.intensity = 1.63;
    fillLight.color.set('#f5f8ff');
    fillLight.position.set(-3.4, 1.8, 2.1);
    fillLight.visible = true;
  }

  const sun = new THREE.DirectionalLight('#fff7ea', 2.3);
  sun.position.copy(earth.sunDirection).multiplyScalar(6);
  scene.scene.add(sun);

  // 3. 鏉愯川涓庝綅缃垵濮嬪寲
  const ringMaterial = createRingMaterial();
  setMaterial(ring.scene, ringMaterial);
  const textMaterials = normalizeText(text.scene); // 鑷姩鎻愬彇骞舵爣鍑嗗寲鏂囧瓧鏉愯川

  earth.group.scale.setScalar(1.2);
  ring.scene.scale.setScalar(0.92);
  text.scene.scale.setScalar(0.92);
  
  // 杈呭姪宸ュ叿锛氬皢妯″瀷涓績瀵归綈鍒版寚瀹氫綅缃?
  moveBoxCenterTo(earth.group, new THREE.Vector3(0, 0.2, 0));
  moveBoxCenterTo(ring.scene, new THREE.Vector3(0, -0.1, 0));
  moveBoxCenterTo(text.scene, new THREE.Vector3(0, -0.09, 0));
  
  ring.scene.visible = false;
  text.scene.visible = false;

  // 4. 灏嗘墍鏈夐儴浠剁粍鍚堝埌涓€涓牴鑺傜偣涓?
  const root = new THREE.Group();
  root.name = 'earth-model-root';
  root.add(earth.group, ring.scene, text.scene);
  scene.attachAndFit(root, 3.0);

  // 璁板綍鍒濆鐘舵€侊紝鐢ㄤ簬鍚庣画鎻掑€?
  scene.modelRoot.position.y = -0.07;
  scene.modelRoot.rotation.x = 0.2;
  scene.modelRoot.rotation.y = 3.0;

  const baseModelY = scene.modelRoot.position.y;
  const baseModelScale = scene.modelRoot.scale.x;
  const baseModelRotationX = scene.modelRoot.rotation.x;
  const baseCameraPosition = scene.camera.position.clone();
  const baseCameraFov = scene.camera.fov;
  const baseRingPosition = ring.scene.position.clone();
  const baseTextPosition = text.scene.position.clone();
  const baseRingScale = ring.scene.scale.x;
  const baseTextScale = text.scene.scale.x;
  const baseAtmosphereScale = 1.04;
  const cameraLookAt = new THREE.Vector3();
  const setBaseScrollState = scene.setScrollState.bind(scene);
  let lastSourceState: SceneScrollState | null = null;
  const timelineConfig = cloneDebugData(DEFAULT_EARTH_TIMELINE_CONFIG);
  const cameraTimeline = {
    nearX: 0.08,
    nearY: 0.12,
    nearZ: 2.08,
    farX: baseCameraPosition.x,
    farY: baseCameraPosition.y,
    farZ: baseCameraPosition.z,
    nearFov: 38,
    farFov: baseCameraFov,
    lookAtNearY: 0.58,
    lookAtFarY: 0.02,
  };
  const motionTimeline = {
    liftStartY: -1.6,
    liftEndY: 0,
    scaleStart: 1.62,
    scaleEnd: 1,
    modelRotXStart: 0.32,
    modelRotXEnd: baseModelRotationX,
    rootRotYStart: -0.22,
    rootRotYEnd: 0.08,
    autoRotateEnabled: true,
    autoRotateSpeed: scene.getAutoRotateSpeed(),
  };

  const debugData: EarthDebugData = {
    stage: {
      forceRingVisible: false,
      forceTextVisible: false,
      ringYOffsetStart: -0.16,
      ringYOffsetEnd: 0,
      textYOffsetStart: -0.1,
      textYOffsetEnd: 0,
      ringScaleStart: 0.9,
      ringScaleEnd: 1,
      textScaleStart: 0.96,
      textScaleEnd: 1,
      textOpacityMax: 0.92,
      ringOpacityBase: 0.14,
      ringEmissiveBase: 0.26,
    },
    globe: {
      bumpScale: earth.globeMaterial.bumpScale,
      normalScale: earth.globeMaterial.normalScale.x,
      dayBrightness: earth.materialUniforms.uDayBrightness.value,
      daySaturation: earth.materialUniforms.uDaySaturation.value,
      oceanLift: earth.materialUniforms.uOceanLift.value,
      oceanCyanShift: earth.materialUniforms.uOceanCyanShift.value,
      landLift: earth.materialUniforms.uLandLift.value,
      landDeYellow: earth.materialUniforms.uLandDeYellow.value,
      vegetationBoost: earth.materialUniforms.uVegetationBoost.value,
      hazeStrength: earth.materialUniforms.uHazeStrength.value,
      cloudLow: earth.materialUniforms.uCloudLow.value,
      cloudHigh: earth.materialUniforms.uCloudHigh.value,
      cloudOpacity: earth.materialUniforms.uCloudOpacity.value,
      cloudBrightness: earth.materialUniforms.uCloudBrightness.value,
      cloudColor: colorToHex(earth.materialUniforms.uCloudColor.value),
      oceanRoughness: earth.materialUniforms.uOceanRoughness.value,
      landRoughness: earth.materialUniforms.uLandRoughness.value,
      cloudRoughness: earth.materialUniforms.uCloudRoughness.value,
      oceanSpecStrength: earth.materialUniforms.uOceanSpecStrength.value,
      oceanFresnelStrength: earth.materialUniforms.uOceanFresnelStrength.value,
      nightIntensity: earth.materialUniforms.uNightIntensity.value,
      nightFadeStart: earth.materialUniforms.uNightFadeStart.value,
      nightFadeEnd: earth.materialUniforms.uNightFadeEnd.value,
    },
    atmosphere: {
      atmosphereDayColor: colorToHex(earth.materialUniforms.uAtmosphereDay.value),
      atmosphereTwilightColor: colorToHex(earth.materialUniforms.uAtmosphereTwilight.value),
      atmosphereStrength: earth.materialUniforms.uAtmosphereStrength.value,
      sunDirX: earth.sunDirection.x,
      sunDirY: earth.sunDirection.y,
      sunDirZ: earth.sunDirection.z,
      atmosphereScale: baseAtmosphereScale,
    },
    lights: {
      ambient: ambientLight ? createLightState(ambientLight) : { enabled: false, color: '#ffffff', intensity: 0 },
      key: keyLight ? createLightState(keyLight) : { enabled: false, color: '#ffffff', intensity: 0 },
      fill: fillLight ? createLightState(fillLight) : { enabled: false, color: '#bfd8ff', intensity: 0 },
      sun: createLightState(sun),
    },
  };
  const defaultDebugData = cloneDebugData(debugData);

  function applyGlobeDebugSettings() {
    earth.globeMaterial.bumpScale = debugData.globe.bumpScale;
    earth.globeMaterial.normalScale.setScalar(debugData.globe.normalScale);
    earth.materialUniforms.uDayBrightness.value = debugData.globe.dayBrightness;
    earth.materialUniforms.uDaySaturation.value = debugData.globe.daySaturation;
    earth.materialUniforms.uOceanLift.value = debugData.globe.oceanLift;
    earth.materialUniforms.uOceanCyanShift.value = debugData.globe.oceanCyanShift;
    earth.materialUniforms.uLandLift.value = debugData.globe.landLift;
    earth.materialUniforms.uLandDeYellow.value = debugData.globe.landDeYellow;
    earth.materialUniforms.uVegetationBoost.value = debugData.globe.vegetationBoost;
    earth.materialUniforms.uHazeStrength.value = debugData.globe.hazeStrength;
    earth.materialUniforms.uCloudLow.value = debugData.globe.cloudLow;
    earth.materialUniforms.uCloudHigh.value = debugData.globe.cloudHigh;
    earth.materialUniforms.uCloudOpacity.value = debugData.globe.cloudOpacity;
    earth.materialUniforms.uCloudBrightness.value = debugData.globe.cloudBrightness;
    earth.materialUniforms.uCloudColor.value.set(debugData.globe.cloudColor);
    earth.cloudMaterial.roughness = debugData.globe.cloudRoughness;
    earth.cloudMaterial.color.set(debugData.globe.cloudColor);
    earth.materialUniforms.uOceanRoughness.value = debugData.globe.oceanRoughness;
    earth.materialUniforms.uLandRoughness.value = debugData.globe.landRoughness;
    earth.materialUniforms.uCloudRoughness.value = debugData.globe.cloudRoughness;
    earth.materialUniforms.uNightIntensity.value = debugData.globe.nightIntensity;
    earth.materialUniforms.uNightFadeStart.value = debugData.globe.nightFadeStart;
    earth.materialUniforms.uNightFadeEnd.value = debugData.globe.nightFadeEnd;
    earth.materialUniforms.uOceanSpecStrength.value = debugData.globe.oceanSpecStrength;
    earth.materialUniforms.uOceanFresnelStrength.value = debugData.globe.oceanFresnelStrength;
  }

  function applyAtmosphereDebugSettings() {
    earth.materialUniforms.uAtmosphereDay.value.set(debugData.atmosphere.atmosphereDayColor);
    earth.materialUniforms.uAtmosphereTwilight.value.set(debugData.atmosphere.atmosphereTwilightColor);
    earth.materialUniforms.uAtmosphereStrength.value = debugData.atmosphere.atmosphereStrength;

    const sunDirection = normalizeSunDirection(
      debugData.atmosphere.sunDirX,
      debugData.atmosphere.sunDirY,
      debugData.atmosphere.sunDirZ,
    );
    earth.sunDirection.copy(sunDirection);
    earth.materialUniforms.uSunDir.value.copy(sunDirection);
    sun.position.copy(sunDirection).multiplyScalar(6);

    const atmosphere = earth.group.getObjectByName('procedural-earth-atmosphere');
    atmosphere?.scale.setScalar(debugData.atmosphere.atmosphereScale);
  }

  function applyLightDebugSettings() {
    if (ambientLight) applyLightState(ambientLight, debugData.lights.ambient);
    if (keyLight) applyLightState(keyLight, debugData.lights.key);
    if (fillLight) applyLightState(fillLight, debugData.lights.fill);
    applyLightState(sun, debugData.lights.sun);
  }

  /** 鐩告満鏃堕棿绾匡細澶勭悊鎷夎繙/闈犺繎鍜岃瑙掑钩绉?*/
  const applyCameraTimeline = ({ pullBack }: EarthTimeline) => {
    scene.camera.position.set(
      THREE.MathUtils.lerp(cameraTimeline.nearX, cameraTimeline.farX, pullBack),
      THREE.MathUtils.lerp(cameraTimeline.nearY, cameraTimeline.farY, pullBack),
      THREE.MathUtils.lerp(cameraTimeline.nearZ, cameraTimeline.farZ, pullBack),
    );
    scene.camera.fov = THREE.MathUtils.lerp(cameraTimeline.nearFov, cameraTimeline.farFov, pullBack);
    scene.camera.updateProjectionMatrix();
    
    cameraLookAt.set(0, THREE.MathUtils.lerp(cameraTimeline.lookAtNearY, cameraTimeline.lookAtFarY, pullBack), 0);
    scene.camera.lookAt(cameraLookAt);
  };

  /** 妯″瀷鏃堕棿绾匡細澶勭悊鍗囪捣銆佺缉鏀惧拰鑷浆鍒囨崲 */
  const applyModelTimeline = ({ liftProgress, pullBack, scrollSpin, spinComplete }: EarthTimeline) => {
    scene.modelRoot.position.y = baseModelY + THREE.MathUtils.lerp(motionTimeline.liftStartY, motionTimeline.liftEndY, liftProgress);
    scene.modelRoot.scale.setScalar(baseModelScale * THREE.MathUtils.lerp(motionTimeline.scaleStart, motionTimeline.scaleEnd, pullBack));
    scene.modelRoot.rotation.x = THREE.MathUtils.lerp(motionTimeline.modelRotXStart, motionTimeline.modelRotXEnd, pullBack);
    root.rotation.y = THREE.MathUtils.lerp(motionTimeline.rootRotYStart, motionTimeline.rootRotYEnd, pullBack);

    earth.group.rotation.y = scrollSpin;
    scene.setAutoRotateSpeed(motionTimeline.autoRotateSpeed);
    // 褰撴粴鍔ㄥ仠姝㈠湪鐗瑰畾鍖哄煙鏃讹紝寮€鍚嚜鍔ㄦ棆杞?
    scene.setAutoRotate(motionTimeline.autoRotateEnabled && spinComplete);
  };

  /** 鑸炲彴瑁呴グ鏃堕棿绾匡細澶勭悊鍦嗙幆鍜屾枃瀛楃殑鍑虹幇鍔ㄧ敾 */
  const applyStageTimeline = ({ staging, textReveal, focus }: EarthTimeline) => {
    // 鏍规嵁杩涘害鍐冲畾鏄鹃殣锛屽噺灏戜笉蹇呰鐨?GPU 缁樺埗
    ring.scene.visible = debugData.stage.forceRingVisible || (staging > 0.001 && focus > 0.001);
    text.scene.visible = debugData.stage.forceTextVisible || (textReveal > 0.001 && focus > 0.001);

    ring.scene.position.y = baseRingPosition.y + THREE.MathUtils.lerp(debugData.stage.ringYOffsetStart, debugData.stage.ringYOffsetEnd, staging);
    text.scene.position.y = baseTextPosition.y + THREE.MathUtils.lerp(debugData.stage.textYOffsetStart, debugData.stage.textYOffsetEnd, textReveal);
    ring.scene.scale.setScalar(baseRingScale * THREE.MathUtils.lerp(debugData.stage.ringScaleStart, debugData.stage.ringScaleEnd, staging));
    text.scene.scale.setScalar(baseTextScale * THREE.MathUtils.lerp(debugData.stage.textScaleStart, debugData.stage.textScaleEnd, textReveal));

    // 鍔ㄦ€佽皟鏁存潗璐ㄥ弬鏁帮細缁撳悎 staging 鍜?focus锛堣浆鍦烘贩鍚堝害锛?
    ringMaterial.opacity = debugData.stage.ringOpacityBase * staging * focus;
    ringMaterial.emissiveIntensity = debugData.stage.ringEmissiveBase * THREE.MathUtils.lerp(0.35, 1, staging);

    for (const material of textMaterials) {
      material.opacity = debugData.stage.textOpacityMax * textReveal * focus;
    }
  };

  function applyResolvedState(sourceState: SceneScrollState) {
    applyGlobeDebugSettings();
    applyAtmosphereDebugSettings();
    applyLightDebugSettings();

    const effectiveState = sourceState;
    setBaseScrollState(effectiveState); // 璋冪敤鐖剁被鍩虹琛屼负

    // 鍏抽敭锛氬皢褰撳墠婊氬姩鐘舵€佹槧灏勪负鍦扮悆涓撳睘鐨勬椂闂寸嚎鍙傛暟
    const timeline = getEarthTimeline(effectiveState, timelineConfig);

    applyCameraTimeline(timeline);
    applyModelTimeline(timeline);
    applyStageTimeline(timeline);
  }

  /** 
   * 鎷︽埅骞堕噸鍐欏満鏅殑婊氬姩鐘舵€佸鐞嗛€昏緫 
   */
  scene.setScrollState = (state: SceneScrollState) => {
    lastSourceState = state;
    applyResolvedState(state);
  };

  const earthScene = scene as ModelScene & EarthSceneDebugControls;
  earthScene.getEarthDebugData = () => debugData;
  earthScene.applyEarthDebug = () => {
    applyResolvedState(lastSourceState ?? createFallbackScrollState());
  };
  earthScene.resetEarthDebug = () => {
    assignDebugData(debugData, cloneDebugData(defaultDebugData));
    applyResolvedState(lastSourceState ?? createFallbackScrollState());
  };
  earthScene.applyEarthDebug();
  return earthScene;
}
