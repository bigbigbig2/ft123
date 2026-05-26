import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { ModelScene } from './ModelScene';
import type { SceneBase, ScenePostEffects, SceneScrollState } from './SceneBase';
import { createProceduralEarth } from './earth/createEarthModel';
import {
  DEFAULT_EARTH_TIMELINE_CONFIG,
  getEarthTimeline,
  type EarthTimeline,
} from './earth/earthTimeline';
import { moveBoxCenterTo, normalizeText } from './earth/earthSceneUtils';
import { loadGLTF } from '../utils/loaders';

const EARTH_MODEL_ROOT = '/models/%E5%9C%B0%E7%90%83%E9%A1%B5%E9%9D%A2%E6%A8%A1%E5%9E%8B';
const EARTH_TEXT_BLOOM_LAYER = 10;
const EARTH_RING_EDGE_BLOOM_LAYER = 11;
const EARTH_BOTTOM_ROOT = '/textures/earth/bottom';
const EARTH_BOTTOM_LAYERS = [
  { path: `${EARTH_BOTTOM_ROOT}/%E5%9C%881%E4%B8%8D%E5%8A%A8.png`, speed: 0 },
  { path: `${EARTH_BOTTOM_ROOT}/%E5%9C%882%E9%A1%BA.png`, speed: 0.08 },
  { path: `${EARTH_BOTTOM_ROOT}/%E5%9C%883%E9%A1%BA.png`, speed: 0.045 },
  { path: `${EARTH_BOTTOM_ROOT}/%E5%9C%884%E9%80%86.png`, speed: -0.06 },
  { path: `${EARTH_BOTTOM_ROOT}/%E5%9C%885%E9%A1%BA.png`, speed: 0.11 },
] as const;
const STAGE_RING_Y_OFFSET_START = -0.16;
const STAGE_RING_Y_OFFSET_END = 0;
const STAGE_RING_SCALE_START = 0.9;
const STAGE_RING_SCALE_END = 1;
const ROOT_INTRO_ROT_Y_START = -0.22;
const ROOT_INTRO_ROT_Y_END = 0.08;
const RING_LAYER_KEYS = ['inner', 'middle', 'outer'] as const;

type EarthRingLayerKey = typeof RING_LAYER_KEYS[number];

/** 鍒涘缓瑁呴グ鐜殑鏉愯川锛氫娇鐢?PhysicalMaterial 妯℃嫙閫忔槑鍙戝厜璐ㄦ劅 */
function createRingUiMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#acd0e8',
    emissive: '#000000',
    emissiveIntensity: 0.23,
    transparent: true,
    opacity: 0.4,
    roughness: 0,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
}

function isRingTopFace(obj: THREE.Object3D) {
  let current: THREE.Object3D | null = obj;
  while (current) {
    if (/^face(?:[1-9]|10)$/.test(current.name)) return true;
    current = current.parent;
  }
  return false;
}

function setRingSurfaceMaterials(
  root: THREE.Object3D,
  topMaterial: THREE.Material,
  sideMaterial: THREE.Material,
) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    const oldMaterial = mesh.material;
    mesh.material = isRingTopFace(mesh) ? topMaterial : sideMaterial;
    mesh.frustumCulled = false;

    if (Array.isArray(oldMaterial)) oldMaterial.forEach((mat) => mat.dispose());
    else oldMaterial?.dispose?.();
  });
}

function createRingEdgeLines(root: THREE.Object3D, material: LineMaterial) {
  const lines: LineSegments2[] = [];
  const faceMeshes: THREE.Mesh[] = [];

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (obj.userData.isRingEdgeLine) return;
    if (!mesh.isMesh || !isRingTopFace(mesh)) return;
    if (!(mesh.geometry instanceof THREE.BufferGeometry)) return;
    faceMeshes.push(mesh);
  });

  for (const mesh of faceMeshes) {
    const edges = new THREE.EdgesGeometry(mesh.geometry, 8);
    const position = edges.getAttribute('position');
    const lineGeometry = new LineSegmentsGeometry();
    lineGeometry.setPositions(Array.from(position.array as ArrayLike<number>));
    edges.dispose();

    const line = new LineSegments2(lineGeometry, material);
    line.computeLineDistances();
    line.name = `${mesh.name || 'ring-face'}-edge`;
    line.userData.isRingEdgeLine = true;
    line.renderOrder = 30;
    line.frustumCulled = false;
    line.layers.enable(EARTH_RING_EDGE_BLOOM_LAYER);
    mesh.add(line);
    lines.push(line);
  }

  return lines;
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

function attachTextNodesToRingLayers(
  textRoot: THREE.Object3D,
  ringLayerNodes: Partial<Record<EarthRingLayerKey, THREE.Object3D>>,
) {
  const attachedTextNodes: THREE.Object3D[] = [];
  const attachToLayer = (layer: EarthRingLayerKey, nodeNames: string[]) => {
    const target = ringLayerNodes[layer];
    if (!target) return;
    target.updateMatrixWorld(true);
    textRoot.updateMatrixWorld(true);

    for (const nodeName of nodeNames) {
      const node = textRoot.getObjectByName(nodeName);
      if (!node) continue;
      target.attach(node);
      attachedTextNodes.push(node);
    }
  };

  attachToLayer('middle', ['文本', '文本.1', '文本1']);
  attachToLayer('outer', ['文本.2', '文本.3', '文本2', '文本3']);

  return attachedTextNodes;
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
  textBloomEnabled: boolean;
  textBloomStrength: number;
  textBloomRadius: number;
  textBloomTint: string;
}

export interface EarthDebugRingEdgeState {
  visible: boolean;
  color: string;
  opacity: number;
  lineWidth: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomTint: string;
}

export interface EarthDebugMaterialState {
  textColor: string;
  textOpacity: number;
  ringColor: string;
  ringOpacity: number;
  ringEmissiveColor: string;
  ringEmissiveIntensity: number;
  sideColor: string;
  sideOpacity: number;
  sideEmissiveColor: string;
  sideEmissiveIntensity: number;
}

export interface EarthDebugSingleMotionState {
  autoRotateEnabled: boolean;
  autoRotateSpeed: number;
  initialRotationY: number;
}

export interface EarthDebugMotionState {
  ring: EarthDebugSingleMotionState;
  earth: EarthDebugSingleMotionState;
  ringLayers: EarthDebugRingLayersMotionState;
}

export interface EarthDebugRingLayersMotionState {
  enabled: boolean;
  inner: EarthDebugSingleMotionState;
  middle: EarthDebugSingleMotionState;
  outer: EarthDebugSingleMotionState;
}

export interface EarthDebugEarthTransformState {
  scale: number;
}

export interface EarthDebugUiTransformState {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  scale: number;
}

export interface EarthDebugBottomHudState {
  visible: boolean;
  opacity: number;
  color: string;
  brightness: number;
  scale: number;
  tiltDeg: number;
  positionY: number;
  positionZ: number;
  speed: number;
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
  cloudMotionEnabled: boolean;
  cloudFlowSpeed: number;
  cloudWarpStrength: number;
  cloudDetailStrength: number;
  cloudEdgeMotion: number;
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
  ringEdge: EarthDebugRingEdgeState;
  materials: EarthDebugMaterialState;
  motion: EarthDebugMotionState;
  uiTransform: EarthDebugUiTransformState;
  earthTransform: EarthDebugEarthTransformState;
  bottomHud: EarthDebugBottomHudState;
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

function createBottomHud(textures: THREE.Texture[]) {
  const group = new THREE.Group();
  group.name = 'earth-bottom-hud';

  textures.forEach((texture, index) => {
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: '#d8f5ff',
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4.35, 4.35), material);
    plane.name = `earth-bottom-hud-plane-${index + 1}`;
    plane.renderOrder = 10 + index;

    const pivot = new THREE.Group();
    pivot.name = `earth-bottom-hud-pivot-${index + 1}`;
    pivot.add(plane);
    group.add(pivot);
  });

  group.rotation.x = THREE.MathUtils.degToRad(-64);
  group.position.set(0, -0.66, 0.06);
  return group;
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
    cameraPosition: [0, 0.35, 4.05],
    cameraLookAt: [0, 0.02, 0],
    autoRotateSpeed: 0.045,
  });

  // 1. 骞跺彂鍔犺浇鎵€鏈夎祫婧?
  const [earth, ring, text, bottomHudTextures] = await Promise.all([
    createProceduralEarth(), // 绋嬪簭鍖栫敓鎴愮殑鍦扮悆锛堝寘鍚珮绾?Shader 鏉愯川锛?
    loadGLTF(`${EARTH_MODEL_ROOT}/huan2.glb`),
    loadGLTF(`${EARTH_MODEL_ROOT}/wenzi.gltf`),
    Promise.all(EARTH_BOTTOM_LAYERS.map((layer) => new THREE.TextureLoader().loadAsync(layer.path))),
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
  const ringMaterial = createRingUiMaterial();
  const ringSideMaterial = createRingUiMaterial();
  setRingSurfaceMaterials(ring.scene, ringMaterial, ringSideMaterial);
  const ringEdgeMaterial = new LineMaterial({
    color: '#9ff8ff',
    transparent: true,
    opacity: 0.85,
    linewidth: 1.8,
    worldUnits: false,
    depthWrite: false,
    depthTest: true,
    alphaToCoverage: true,
  });
  ringEdgeMaterial.resolution.set(
    Math.max(1, Math.round(window.innerWidth * window.devicePixelRatio)),
    Math.max(1, Math.round(window.innerHeight * window.devicePixelRatio)),
  );
  const ringEdgeLines = createRingEdgeLines(ring.scene, ringEdgeMaterial);
  const ringGroup = new THREE.Group();
  ringGroup.name = 'earth-ring-group';
  ringGroup.add(ring.scene);
  const ringLayerNodes: Record<EarthRingLayerKey, THREE.Object3D | undefined> = {
    inner: ring.scene.getObjectByName('内'),
    middle: ring.scene.getObjectByName('中'),
    outer: ring.scene.getObjectByName('外'),
  };
  const ringLayerBaseRotationY: Record<EarthRingLayerKey, number> = {
    inner: ringLayerNodes.inner?.rotation.y ?? 0,
    middle: ringLayerNodes.middle?.rotation.y ?? 0,
    outer: ringLayerNodes.outer?.rotation.y ?? 0,
  };
  text.scene.traverse((obj) => obj.layers.enable(EARTH_TEXT_BLOOM_LAYER));
  const textMaterials = normalizeText(text.scene); // 鑷姩鎻愬彇骞舵爣鍑嗗寲鏂囧瓧鏉愯川

  earth.group.scale.setScalar(1.2);
  ringGroup.scale.setScalar(0.92);
  text.scene.scale.setScalar(0.92);
  
  // 杈呭姪宸ュ叿锛氬皢妯″瀷涓績瀵归綈鍒版寚瀹氫綅缃?
  moveBoxCenterTo(earth.group, new THREE.Vector3(0, 0.2, 0));
  const earthUiGroup = new THREE.Group();
  earthUiGroup.name = 'earth-ui-group';
  earthUiGroup.add(ringGroup, text.scene);
  moveBoxCenterTo(earthUiGroup, new THREE.Vector3(0, -0.1, 0));
  const baseEarthUiPosition = earthUiGroup.position.clone();
  const ringTextNodes = attachTextNodesToRingLayers(text.scene, ringLayerNodes);
  let ringTextVisible = false;
  
  ringGroup.visible = false;
  text.scene.visible = false;
  ringTextNodes.forEach((node) => {
    node.visible = false;
  });

  // 4. 灏嗘墍鏈夐儴浠剁粍鍚堝埌涓€涓牴鑺傜偣涓?
  const root = new THREE.Group();
  root.name = 'earth-model-root';
  root.add(earth.group, earthUiGroup);
  scene.attachAndFit(root, 3.0);
  const bottomHud = createBottomHud(bottomHudTextures);
  scene.scene.add(bottomHud);

  // 璁板綍鍒濆鐘舵€侊紝鐢ㄤ簬鍚庣画鎻掑€?
  scene.modelRoot.position.y = -0.07;
  scene.modelRoot.rotation.x = 0.2;
  scene.modelRoot.rotation.y = 3.0;

  const baseModelY = scene.modelRoot.position.y;
  const baseModelScale = scene.modelRoot.scale.x;
  const baseModelRotationX = scene.modelRoot.rotation.x;
  const baseCameraPosition = scene.camera.position.clone();
  const baseCameraFov = scene.camera.fov;
  const baseRingPosition = ringGroup.position.clone();
  const baseRingScale = ringGroup.scale.x;
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
    rootRotYStart: ROOT_INTRO_ROT_Y_START,
    rootRotYEnd: ROOT_INTRO_ROT_Y_END,
  };

  const debugData: EarthDebugData = {
    stage: {
      textBloomEnabled: true,
      textBloomStrength: 0.5,
      textBloomRadius: 0.3,
      textBloomTint: '#d3e4e8',
    },
    ringEdge: {
      visible: true,
      color: '#bfe8ff',
      opacity: 0.95,
      lineWidth: 1.2,
      bloomEnabled: true,
      bloomStrength: 0.2,
      bloomRadius: 0.1,
      bloomTint: '#bfe8ff',
    },
    materials: {
      textColor: '#ffffff',
      textOpacity: 1.5,
      ringColor: '#c1d5e2',
      ringOpacity: 0.63,
      ringEmissiveColor: '#000000',
      ringEmissiveIntensity: 0,
      sideColor: '#c0d4df',
      sideOpacity: 0.43,
      sideEmissiveColor: '#000000',
      sideEmissiveIntensity: 0,
    },
    motion: {
      ring: {
        autoRotateEnabled: true,
        autoRotateSpeed: -0.25,
        initialRotationY: 0.068,
      },
      ringLayers: {
        enabled: true,
        inner: {
          autoRotateEnabled: true,
          autoRotateSpeed: -0.08,
          initialRotationY: 0,
        },
        middle: {
          autoRotateEnabled: true,
          autoRotateSpeed: 0.14,
          initialRotationY: 0,
        },
        outer: {
          autoRotateEnabled: true,
          autoRotateSpeed: 0.045,
          initialRotationY: 0,
        },
      },
      earth: {
        autoRotateEnabled: true,
        autoRotateSpeed: 0.25,
        initialRotationY: -1.229,
      },
    },
    uiTransform: {
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      scale: 1,
    },
    earthTransform: {
      scale: 0.85,
    },
    bottomHud: {
      visible: true,
      opacity: 1,
      color: '#d8f5ff',
      brightness: 4,
      scale: 1.9,
      tiltDeg: -78.4,
      positionY: -1.67,
      positionZ: -5,
      speed: 4,
    },
    globe: {
      bumpScale: 0.06,
      normalScale: 2.01,
      dayBrightness: 1.12,
      daySaturation: 0.82,
      oceanLift: 0.52,
      oceanCyanShift: 0.36,
      landLift: 0.74,
      landDeYellow: 0.58,
      vegetationBoost: 0.52,
      hazeStrength: 0.72,
      cloudLow: 0.043,
      cloudHigh: 0.62,
      cloudOpacity: 0.799,
      cloudBrightness: 1.33,
      cloudColor: '#ebebeb',
      cloudMotionEnabled: true,
      cloudFlowSpeed: 0.018,
      cloudWarpStrength: 0.018,
      cloudDetailStrength: 0.28,
      cloudEdgeMotion: 0.12,
      oceanRoughness: 0.739,
      landRoughness: 0.9,
      cloudRoughness: 0.96,
      oceanSpecStrength: 0,
      oceanFresnelStrength: 0,
      nightIntensity: 3.91,
      nightFadeStart: 0,
      nightFadeEnd: 0.5,
    },
    atmosphere: {
      atmosphereDayColor: '#daedff',
      atmosphereTwilightColor: '#a6cdf5',
      atmosphereStrength: 0.6,
      sunDirX: 0.413,
      sunDirY: 0.391,
      sunDirZ: 0.435,
      atmosphereScale: 1.04,
    },
    lights: {
      ambient: ambientLight ? { ...createLightState(ambientLight), enabled: true, color: '#7cabff' } : { enabled: true, color: '#7cabff', intensity: 0 },
      key: keyLight ? createLightState(keyLight) : { enabled: false, color: '#ffffff', intensity: 0 },
      fill: fillLight ? createLightState(fillLight) : { enabled: false, color: '#bfd8ff', intensity: 0 },
      sun: createLightState(sun),
    },
  };
  const defaultDebugData = cloneDebugData(debugData);
  let ringRotationY = debugData.motion.ring.initialRotationY;
  let earthRotationY = debugData.motion.earth.initialRotationY;
  const ringLayerRotationY: Record<EarthRingLayerKey, number> = {
    inner: debugData.motion.ringLayers.inner.initialRotationY,
    middle: debugData.motion.ringLayers.middle.initialRotationY,
    outer: debugData.motion.ringLayers.outer.initialRotationY,
  };
  let appliedRingInitialRotationY = debugData.motion.ring.initialRotationY;
  let appliedEarthInitialRotationY = debugData.motion.earth.initialRotationY;
  const appliedRingLayerInitialRotationY: Record<EarthRingLayerKey, number> = {
    inner: debugData.motion.ringLayers.inner.initialRotationY,
    middle: debugData.motion.ringLayers.middle.initialRotationY,
    outer: debugData.motion.ringLayers.outer.initialRotationY,
  };

  function applyMaterialDebugSettings() {
    ringMaterial.color.set(debugData.materials.ringColor);
    ringMaterial.opacity = debugData.materials.ringOpacity;
    ringMaterial.emissive.set(debugData.materials.ringEmissiveColor);
    ringMaterial.emissiveIntensity = debugData.materials.ringEmissiveIntensity;
    ringMaterial.needsUpdate = true;

    ringSideMaterial.color.set(debugData.materials.sideColor);
    ringSideMaterial.opacity = debugData.materials.sideOpacity;
    ringSideMaterial.emissive.set(debugData.materials.sideEmissiveColor);
    ringSideMaterial.emissiveIntensity = debugData.materials.sideEmissiveIntensity;
    ringSideMaterial.needsUpdate = true;

    for (const material of textMaterials) {
      material.color.set(debugData.materials.textColor);
    }
  }

  function applyRingEdgeDebugSettings() {
    ringEdgeMaterial.color.set(debugData.ringEdge.color);
    ringEdgeMaterial.opacity = debugData.ringEdge.opacity;
    ringEdgeMaterial.linewidth = debugData.ringEdge.lineWidth;
    ringEdgeMaterial.needsUpdate = true;

    for (const line of ringEdgeLines) {
      line.visible = debugData.ringEdge.visible;
    }
  }

  function applyRingLayerTransforms() {
    const enabled = debugData.motion.ringLayers.enabled;

    for (const key of RING_LAYER_KEYS) {
      const node = ringLayerNodes[key];
      const layerRotationY = enabled ? ringLayerRotationY[key] : 0;
      if (node) {
        node.rotation.y = ringLayerBaseRotationY[key] + layerRotationY;
      }
    }
  }

  function applyRingLayerMotionDebugSettings() {
    for (const key of RING_LAYER_KEYS) {
      const state = debugData.motion.ringLayers[key];
      const initialDelta = state.initialRotationY - appliedRingLayerInitialRotationY[key];

      if (Math.abs(initialDelta) > 0.000001) {
        ringLayerRotationY[key] += initialDelta;
        appliedRingLayerInitialRotationY[key] = state.initialRotationY;
      }
    }

    applyRingLayerTransforms();
  }

  function applyRingTextGroupRotation() {
    earthUiGroup.rotation.y = ringRotationY;
  }

  function applyMotionDebugSettings() {
    const ringInitialDelta = debugData.motion.ring.initialRotationY - appliedRingInitialRotationY;
    if (Math.abs(ringInitialDelta) > 0.000001) {
      ringRotationY += ringInitialDelta;
      appliedRingInitialRotationY = debugData.motion.ring.initialRotationY;
    }

    const earthInitialDelta = debugData.motion.earth.initialRotationY - appliedEarthInitialRotationY;
    if (Math.abs(earthInitialDelta) > 0.000001) {
      earthRotationY += earthInitialDelta;
      appliedEarthInitialRotationY = debugData.motion.earth.initialRotationY;
    }

    applyRingLayerMotionDebugSettings();
  }

  function applyUiTransformDebugSettings() {
    earthUiGroup.position.set(
      baseEarthUiPosition.x + debugData.uiTransform.offsetX,
      baseEarthUiPosition.y + debugData.uiTransform.offsetY,
      baseEarthUiPosition.z + debugData.uiTransform.offsetZ,
    );
    earthUiGroup.scale.setScalar(debugData.uiTransform.scale);
  }

  function applyEarthTransformDebugSettings() {
    earth.group.scale.setScalar(1.2 * debugData.earthTransform.scale);
  }

  function applyBottomHudDebugSettings() {
    bottomHud.visible = debugData.bottomHud.visible;
    bottomHud.scale.setScalar(debugData.bottomHud.scale);
    bottomHud.rotation.x = THREE.MathUtils.degToRad(debugData.bottomHud.tiltDeg);
    bottomHud.position.y = debugData.bottomHud.positionY;
    bottomHud.position.z = debugData.bottomHud.positionZ;

    bottomHud.traverse((obj) => {
      const material = (obj as THREE.Mesh).material;
      if (!material) return;
      if (Array.isArray(material)) {
        material.forEach((mat) => {
          if ('opacity' in mat) mat.opacity = debugData.bottomHud.opacity;
          if ('color' in mat && mat.color instanceof THREE.Color) {
            mat.color.set(debugData.bottomHud.color).multiplyScalar(debugData.bottomHud.brightness);
          }
        });
      } else if ('opacity' in material) {
        material.opacity = debugData.bottomHud.opacity;
        if ('color' in material && material.color instanceof THREE.Color) {
          material.color.set(debugData.bottomHud.color).multiplyScalar(debugData.bottomHud.brightness);
        }
      }
    });
  }

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
    earth.materialUniforms.uCloudMotionEnabled.value = debugData.globe.cloudMotionEnabled ? 1 : 0;
    earth.materialUniforms.uCloudFlowSpeed.value = debugData.globe.cloudFlowSpeed;
    earth.materialUniforms.uCloudWarpStrength.value = debugData.globe.cloudWarpStrength;
    earth.materialUniforms.uCloudDetailStrength.value = debugData.globe.cloudDetailStrength;
    earth.materialUniforms.uCloudEdgeMotion.value = debugData.globe.cloudEdgeMotion;
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

    earth.group.rotation.y = scrollSpin + earthRotationY;
    applyRingTextGroupRotation();
    // 褰撴粴鍔ㄥ仠姝㈠湪鐗瑰畾鍖哄煙鏃讹紝寮€鍚嚜鍔ㄦ棆杞?
    scene.setAutoRotate(false);
  };

  /** 鑸炲彴瑁呴グ鏃堕棿绾匡細澶勭悊鍦嗙幆鍜屾枃瀛楃殑鍑虹幇鍔ㄧ敾 */
  const applyStageTimeline = ({ staging, textReveal, focus }: EarthTimeline) => {
    // 鏍规嵁杩涘害鍐冲畾鏄鹃殣锛屽噺灏戜笉蹇呰鐨?GPU 缁樺埗
    ringGroup.visible = staging > 0.001 && focus > 0.001;
    ringTextVisible = textReveal > 0.001 && focus > 0.001;
    text.scene.visible = ringTextVisible;
    ringTextNodes.forEach((node) => {
      node.visible = ringTextVisible;
    });

    ringGroup.position.y = baseRingPosition.y + THREE.MathUtils.lerp(STAGE_RING_Y_OFFSET_START, STAGE_RING_Y_OFFSET_END, staging);
    ringGroup.scale.setScalar(baseRingScale * THREE.MathUtils.lerp(STAGE_RING_SCALE_START, STAGE_RING_SCALE_END, staging));

    // 鍔ㄦ€佽皟鏁存潗璐ㄥ弬鏁帮細缁撳悎 staging 鍜?focus锛堣浆鍦烘贩鍚堝害锛?
    ringMaterial.opacity = debugData.materials.ringOpacity * staging * focus;
    ringMaterial.emissiveIntensity = debugData.materials.ringEmissiveIntensity * THREE.MathUtils.lerp(0.35, 1, staging);
    ringSideMaterial.opacity = debugData.materials.sideOpacity * staging * focus;
    ringSideMaterial.emissiveIntensity = debugData.materials.sideEmissiveIntensity * THREE.MathUtils.lerp(0.35, 1, staging);
    ringEdgeMaterial.opacity = debugData.ringEdge.opacity * staging * focus;

    for (const material of textMaterials) {
      material.opacity = debugData.materials.textOpacity * textReveal * focus;
    }
  };

  function applyResolvedState(sourceState: SceneScrollState) {
    applyMaterialDebugSettings();
    applyRingEdgeDebugSettings();
    applyMotionDebugSettings();
    applyUiTransformDebugSettings();
    applyEarthTransformDebugSettings();
    applyBottomHudDebugSettings();
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

  const baseSetSize = scene.setSize.bind(scene);
  scene.setSize = (width: number, height: number) => {
    baseSetSize(width, height);
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    ringEdgeMaterial.resolution.set(
      Math.max(1, Math.round(width * pixelRatio)),
      Math.max(1, Math.round(height * pixelRatio)),
    );
  };

  const baseUpdate = scene.update.bind(scene);
  scene.update = (delta: number, elapsed: number) => {
    baseUpdate(delta, elapsed);
    earth.materialUniforms.uCloudTime.value = elapsed;
    if (debugData.motion.ring.autoRotateEnabled) {
      ringRotationY += delta * debugData.motion.ring.autoRotateSpeed;
      applyRingTextGroupRotation();
    }
    if (debugData.motion.earth.autoRotateEnabled) {
      earthRotationY += delta * debugData.motion.earth.autoRotateSpeed;
    }
    if (debugData.motion.ringLayers.enabled) {
      for (const key of RING_LAYER_KEYS) {
        const state = debugData.motion.ringLayers[key];
        if (!state.autoRotateEnabled) continue;
        ringLayerRotationY[key] += delta * state.autoRotateSpeed;
      }
      applyRingLayerTransforms();
    }
    bottomHud.children.forEach((pivot, index) => {
      const layer = EARTH_BOTTOM_LAYERS[index];
      if (!layer) return;
      pivot.rotation.z += delta * layer.speed * debugData.bottomHud.speed;
    });
  };

  const getPostEffects = (): ScenePostEffects => ({
    bloom: [
      {
        enabled: debugData.stage.textBloomEnabled && ringTextVisible,
        layer: EARTH_TEXT_BLOOM_LAYER,
        strength: debugData.stage.textBloomStrength,
        radius: debugData.stage.textBloomRadius,
        tint: debugData.stage.textBloomTint,
        resolutionScale: 0.5,
      },
      {
        enabled: debugData.ringEdge.bloomEnabled && debugData.ringEdge.visible && ringGroup.visible,
        layer: EARTH_RING_EDGE_BLOOM_LAYER,
        strength: debugData.ringEdge.bloomStrength,
        radius: debugData.ringEdge.bloomRadius,
        tint: debugData.ringEdge.bloomTint,
        resolutionScale: 1,
      },
    ],
  });

  const earthScene = scene as ModelScene & EarthSceneDebugControls & { getPostEffects(): ScenePostEffects };
  earthScene.getPostEffects = getPostEffects;
  earthScene.getEarthDebugData = () => debugData;
  earthScene.applyEarthDebug = () => {
    applyResolvedState(lastSourceState ?? createFallbackScrollState());
  };
  earthScene.resetEarthDebug = () => {
    //@ts-ignore
    assignDebugData(debugData, cloneDebugData(defaultDebugData));
    applyResolvedState(lastSourceState ?? createFallbackScrollState());
  };
  earthScene.applyEarthDebug();
  return earthScene;
}
