import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { ModelScene } from './ModelScene';
import type { SceneBase, ScenePostProcessable, ScenePostPipeline, SceneScrollState } from './SceneBase';
import { createProceduralEarth } from './earth/createEarthModel';
import { EarthPostPipeline } from './earth/EarthPostPipeline';
import {
  DEFAULT_EARTH_TIMELINE_CONFIG,
  getEarthTimeline,
  type EarthTimeline,
} from './earth/earthTimeline';
import { moveBoxCenterTo, normalizeText } from './earth/earthSceneUtils';
import { loadGLTF, loadTexture } from '../utils/loaders';

const EARTH_MODEL_ROOT = '/models/%E5%9C%B0%E7%90%83%E9%A1%B5%E9%9D%A2%E6%A8%A1%E5%9E%8B';
const EARTH_TEXTURE_ROOT = '/textures/earth';
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
const BOTTOM_HUD_RENDER_ORDER = -20;
const RING_TEXT_RENDER_ORDER = 28;
const RING_LAYER_KEYS = ['inner', 'middle', 'outer'] as const;
const RING_TEXTURE_FACE_KEYS = ['face3', 'face8', 'face9'] as const;

type EarthRingLayerKey = typeof RING_LAYER_KEYS[number];
type EarthRingTextureFaceKey = typeof RING_TEXTURE_FACE_KEYS[number];

interface RingTextureUvBounds {
  min: [number, number];
  size: [number, number];
}

interface RingTexturePositionBounds {
  min: [number, number];
  size: [number, number];
}

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

function applyRingUiMaterialOpacity(material: THREE.MeshStandardMaterial, opacity: number) {
  const isOpaque = opacity >= 0.999;
  material.opacity = opacity;
  material.transparent = !isOpaque;
  material.depthWrite = isOpaque;
  material.needsUpdate = true;
}

interface RingTextureMaterialOptions {
  baseColor: THREE.ColorRepresentation;
  tintColor: THREE.ColorRepresentation;
  panelOpacity: number;
  textureOpacity: number;
  brightness: number;
  blackCutoff: number;
  blackFeather: number;
  uvBounds: RingTextureUvBounds;
  positionBounds: RingTexturePositionBounds;
  uvFitEnabled: boolean;
  uvOffset: [number, number];
  uvScale: [number, number];
  uvRotation: number;
  uvFlipX: boolean;
  uvFlipY: boolean;
  uvSwap: boolean;
}

function createRingTextureMaterial(
  texture: THREE.Texture,
  name: string,
  options: RingTextureMaterialOptions,
) {
  texture.flipY = false;
  texture.needsUpdate = true;

  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      uMap: { value: texture },
      uOpacity: { value: options.textureOpacity },
      uBaseOpacity: { value: options.panelOpacity },
      uBaseColor: { value: new THREE.Color(options.baseColor) },
      uTintColor: { value: new THREE.Color(options.tintColor) },
      uPanelOpacity: { value: options.panelOpacity },
      uBrightness: { value: options.brightness },
      uBlackCutoff: { value: options.blackCutoff },
      uBlackFeather: { value: options.blackFeather },
      uUvBoundsMin: { value: new THREE.Vector2(options.uvBounds.min[0], options.uvBounds.min[1]) },
      uUvBoundsSize: { value: new THREE.Vector2(options.uvBounds.size[0], options.uvBounds.size[1]) },
      uPositionBoundsMin: { value: new THREE.Vector2(options.positionBounds.min[0], options.positionBounds.min[1]) },
      uPositionBoundsSize: { value: new THREE.Vector2(options.positionBounds.size[0], options.positionBounds.size[1]) },
      uUvFitEnabled: { value: options.uvFitEnabled ? 1 : 0 },
      uUvOffset: { value: new THREE.Vector2(options.uvOffset[0], options.uvOffset[1]) },
      uUvScale: { value: new THREE.Vector2(options.uvScale[0], options.uvScale[1]) },
      uUvRotation: { value: options.uvRotation },
      uUvFlip: { value: new THREE.Vector2(options.uvFlipX ? -1 : 1, options.uvFlipY ? -1 : 1) },
      uUvSwap: { value: options.uvSwap ? 1 : 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec2 vLocalPlane;

      void main() {
        vUv = uv;
        vLocalPlane = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uOpacity;
      uniform float uBaseOpacity;
      uniform vec3 uBaseColor;
      uniform vec3 uTintColor;
      uniform float uPanelOpacity;
      uniform float uBrightness;
      uniform float uBlackCutoff;
      uniform float uBlackFeather;
      uniform vec2 uUvBoundsMin;
      uniform vec2 uUvBoundsSize;
      uniform vec2 uPositionBoundsMin;
      uniform vec2 uPositionBoundsSize;
      uniform float uUvFitEnabled;
      uniform vec2 uUvOffset;
      uniform vec2 uUvScale;
      uniform float uUvRotation;
      uniform vec2 uUvFlip;
      uniform float uUvSwap;

      varying vec2 vUv;
      varying vec2 vLocalPlane;

      vec2 transformRingTextureUv(vec2 uv) {
        vec2 fittedUv = (vLocalPlane - uPositionBoundsMin) / max(uPositionBoundsSize, vec2(0.0001));
        vec2 sourceUv = mix(uv, fittedUv, uUvFitEnabled);
        vec2 mappedUv = uUvSwap > 0.5 ? sourceUv.yx : sourceUv;
        vec2 centered = (mappedUv - 0.5) * uUvFlip;
        float s = sin(uUvRotation);
        float c = cos(uUvRotation);
        centered = mat2(c, -s, s, c) * centered;
        return centered * uUvScale + 0.5 + uUvOffset;
      }

      void main() {
        vec2 textureUv = transformRingTextureUv(vUv);
        vec4 texel = texture2D(uMap, textureUv);
        float luminance = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
        float highlight = smoothstep(uBlackCutoff, uBlackCutoff + uBlackFeather, luminance);
        vec3 textureColor = texel.rgb * uBrightness * uTintColor;
        textureColor += highlight * uTintColor * 0.16;
        vec3 color = mix(uBaseColor, textureColor, clamp(uOpacity, 0.0, 1.0));
        float alpha = clamp(max(uBaseOpacity, uPanelOpacity) + texel.a * uOpacity, 0.0, 1.0);

        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
}

function getRingFaceMesh(root: THREE.Object3D, nodeName: EarthRingTextureFaceKey) {
  const mesh = root.getObjectByName(nodeName) as THREE.Mesh | undefined;
  return mesh?.isMesh ? mesh : null;
}

function getMeshUvBounds(mesh: THREE.Mesh | null): RingTextureUvBounds {
  const uv = mesh?.geometry?.getAttribute('uv');
  if (!uv || uv.count <= 0) return { min: [0, 0], size: [1, 1] };

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  for (let i = 0; i < uv.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  if (!Number.isFinite(minU) || !Number.isFinite(minV)) {
    return { min: [0, 0], size: [1, 1] };
  }

  return {
    min: [minU, minV],
    size: [Math.max(maxU - minU, 0.0001), Math.max(maxV - minV, 0.0001)],
  };
}

function getMeshPositionBounds(mesh: THREE.Mesh | null): RingTexturePositionBounds {
  const position = mesh?.geometry?.getAttribute('position');
  if (!position || position.count <= 0) return { min: [0, 0], size: [1, 1] };

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) {
    return { min: [0, 0], size: [1, 1] };
  }

  return {
    min: [minX, minZ],
    size: [Math.max(maxX - minX, 0.0001), Math.max(maxZ - minZ, 0.0001)],
  };
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

function setRingFaceTextureMaterial(
  root: THREE.Object3D,
  nodeName: EarthRingTextureFaceKey,
  material: THREE.Material,
) {
  const mesh = getRingFaceMesh(root, nodeName);
  if (!mesh) return;

  mesh.material = material;
  mesh.renderOrder = 18;
  mesh.frustumCulled = false;
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
    mesh.add(line);
    lines.push(line);
  }

  return lines;
}

function setTextRenderOrder(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.renderOrder = RING_TEXT_RENDER_ORDER;
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

export interface EarthDebugRingEdgeState {
  visible: boolean;
  color: string;
  opacity: number;
  lineWidth: number;
}

export interface EarthDebugMaterialState {
  textColor: string;
  textOpacity: number;
  ringColor: string;
  ringOpacity: number;
  ringEmissiveColor: string;
  ringEmissiveIntensity: number;
  ringTexturePanelOpacity: number;
  ringTexture1Opacity: number;
  ringTexture1Brightness: number;
  ringTexture2Opacity: number;
  ringTexture2Brightness: number;
  ringTextureFace3Visible: boolean;
  ringTextureFace3UvFitEnabled: boolean;
  ringTextureFace3UvOffsetX: number;
  ringTextureFace3UvOffsetY: number;
  ringTextureFace3UvScaleX: number;
  ringTextureFace3UvScaleY: number;
  ringTextureFace3UvRotation: number;
  ringTextureFace3UvFlipX: boolean;
  ringTextureFace3UvFlipY: boolean;
  ringTextureFace3UvSwap: boolean;
  ringTextureFace8Visible: boolean;
  ringTextureFace8UvFitEnabled: boolean;
  ringTextureFace8UvOffsetX: number;
  ringTextureFace8UvOffsetY: number;
  ringTextureFace8UvScaleX: number;
  ringTextureFace8UvScaleY: number;
  ringTextureFace8UvRotation: number;
  ringTextureFace8UvFlipX: boolean;
  ringTextureFace8UvFlipY: boolean;
  ringTextureFace8UvSwap: boolean;
  ringTextureFace9Visible: boolean;
  ringTextureFace9UvFitEnabled: boolean;
  ringTextureFace9UvOffsetX: number;
  ringTextureFace9UvOffsetY: number;
  ringTextureFace9UvScaleX: number;
  ringTextureFace9UvScaleY: number;
  ringTextureFace9UvRotation: number;
  ringTextureFace9UvFlipX: boolean;
  ringTextureFace9UvFlipY: boolean;
  ringTextureFace9UvSwap: boolean;
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

export interface EarthDebugPostState {
  enabled: boolean;
  toneMappingMode: EarthPostToneMappingMode;
  exposure: number;
}

export type EarthPostToneMappingMode =
  | 'LINEAR'
  | 'REINHARD'
  | 'REINHARD2'
  | 'UNCHARTED2'
  | 'CINEON'
  | 'ACES_FILMIC'
  | 'AGX'
  | 'NEUTRAL';

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
  ringEdge: EarthDebugRingEdgeState;
  materials: EarthDebugMaterialState;
  motion: EarthDebugMotionState;
  uiTransform: EarthDebugUiTransformState;
  earthTransform: EarthDebugEarthTransformState;
  bottomHud: EarthDebugBottomHudState;
  post: EarthDebugPostState;
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
    plane.renderOrder = BOTTOM_HUD_RENDER_ORDER + index;

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
  const [earth, ring, text, bottomHudTextures, ringTexture1, ringTexture2] = await Promise.all([
    createProceduralEarth(), // 绋嬪簭鍖栫敓鎴愮殑鍦扮悆锛堝寘鍚珮绾?Shader 鏉愯川锛?
    loadGLTF(`${EARTH_MODEL_ROOT}/huan2.glb`),
    loadGLTF(`${EARTH_MODEL_ROOT}/wenzi.gltf`),
    Promise.all(EARTH_BOTTOM_LAYERS.map((layer) => new THREE.TextureLoader().loadAsync(layer.path))),
    loadTexture(`${EARTH_TEXTURE_ROOT}/1.png`, {
      colorSpace: THREE.SRGBColorSpace,
      wrap: THREE.ClampToEdgeWrapping,
    }),
    loadTexture(`${EARTH_TEXTURE_ROOT}/2.png`, {
      colorSpace: THREE.SRGBColorSpace,
      wrap: THREE.ClampToEdgeWrapping,
    }),
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
  const ringTextureFaceMeshes: Record<EarthRingTextureFaceKey, THREE.Mesh | null> = {
    face3: getRingFaceMesh(ring.scene, 'face3'),
    face8: getRingFaceMesh(ring.scene, 'face8'),
    face9: getRingFaceMesh(ring.scene, 'face9'),
  };
  const ringTextureFaceMaterials: Record<EarthRingTextureFaceKey, THREE.ShaderMaterial> = {
    face3: createRingTextureMaterial(ringTexture1, 'EarthRingFace3StripeTextureMaterial', {
      baseColor: '#9fdfff',
      tintColor: '#c7f5ff',
      panelOpacity: 0.18,
      textureOpacity: 0,
      brightness: 1.65,
      blackCutoff: 0.12,
      blackFeather: 0.32,
      uvBounds: getMeshUvBounds(ringTextureFaceMeshes.face3),
      positionBounds: getMeshPositionBounds(ringTextureFaceMeshes.face3),
      uvFitEnabled: true,
      uvOffset: [0, 0],
      uvScale: [1, 1],
      uvRotation: 0,
      uvFlipX: false,
      uvFlipY: false,
      uvSwap: false,
    }),
    face8: createRingTextureMaterial(ringTexture2, 'EarthRingFace8ImageTextureMaterial', {
      baseColor: '#7ed8ff',
      tintColor: '#ffffff',
      panelOpacity: 0.2,
      textureOpacity: 0,
      brightness: 1.42,
      blackCutoff: 0.08,
      blackFeather: 0.22,
      uvBounds: getMeshUvBounds(ringTextureFaceMeshes.face8),
      positionBounds: getMeshPositionBounds(ringTextureFaceMeshes.face8),
      uvFitEnabled: true,
      uvOffset: [0, 0],
      uvScale: [1, 1],
      uvRotation: 0,
      uvFlipX: false,
      uvFlipY: false,
      uvSwap: false,
    }),
    face9: createRingTextureMaterial(ringTexture1, 'EarthRingFace9StripeTextureMaterial', {
      baseColor: '#9fdfff',
      tintColor: '#c7f5ff',
      panelOpacity: 0.18,
      textureOpacity: 0,
      brightness: 1.65,
      blackCutoff: 0.12,
      blackFeather: 0.32,
      uvBounds: getMeshUvBounds(ringTextureFaceMeshes.face9),
      positionBounds: getMeshPositionBounds(ringTextureFaceMeshes.face9),
      uvFitEnabled: true,
      uvOffset: [0, 0],
      uvScale: [1, 1],
      uvRotation: 0,
      uvFlipX: false,
      uvFlipY: false,
      uvSwap: false,
    }),
  };
  for (const faceKey of RING_TEXTURE_FACE_KEYS) {
    setRingFaceTextureMaterial(ring.scene, faceKey, ringTextureFaceMaterials[faceKey]);
  }
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
  const textMaterials = normalizeText(text.scene); // 鑷姩鎻愬彇骞舵爣鍑嗗寲鏂囧瓧鏉愯川
  setTextRenderOrder(text.scene);

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
    ringEdge: {
      visible: true,
      color: '#bfe8ff',
      opacity: 0.95,
      lineWidth: 1.2,
    },
    post: {
      enabled: false,
      toneMappingMode: 'ACES_FILMIC',
      exposure: 1,
    },
    materials: {
      textColor: '#ffffff',
      textOpacity: 1.5,
      ringColor: '#c1d5e2',
      ringOpacity: 0.63,
      ringEmissiveColor: '#000000',
      ringEmissiveIntensity: 0,
      ringTexturePanelOpacity: 0.18,
      ringTexture1Opacity: 0.78,
      ringTexture1Brightness: 1.65,
      ringTexture2Opacity: 0.86,
      ringTexture2Brightness: 1.42,
      ringTextureFace3Visible: false,
      ringTextureFace3UvFitEnabled: true,
      ringTextureFace3UvOffsetX: 0,
      ringTextureFace3UvOffsetY: 0,
      ringTextureFace3UvScaleX: 1,
      ringTextureFace3UvScaleY: 1,
      ringTextureFace3UvRotation: 0,
      ringTextureFace3UvFlipX: false,
      ringTextureFace3UvFlipY: false,
      ringTextureFace3UvSwap: false,
      ringTextureFace8Visible: false,
      ringTextureFace8UvFitEnabled: true,
      ringTextureFace8UvOffsetX: 0,
      ringTextureFace8UvOffsetY: 0,
      ringTextureFace8UvScaleX: 1,
      ringTextureFace8UvScaleY: 1,
      ringTextureFace8UvRotation: 0,
      ringTextureFace8UvFlipX: false,
      ringTextureFace8UvFlipY: false,
      ringTextureFace8UvSwap: false,
      ringTextureFace9Visible: false,
      ringTextureFace9UvFitEnabled: true,
      ringTextureFace9UvOffsetX: 0,
      ringTextureFace9UvOffsetY: 0,
      ringTextureFace9UvScaleX: 1,
      ringTextureFace9UvScaleY: 1,
      ringTextureFace9UvRotation: 0,
      ringTextureFace9UvFlipX: false,
      ringTextureFace9UvFlipY: false,
      ringTextureFace9UvSwap: false,
      sideColor: '#c0d4df',
      sideOpacity: 0.17,
      sideEmissiveColor: '#000000',
      sideEmissiveIntensity: 0,
    },
    motion: {
      ring: {
        autoRotateEnabled: true,
        autoRotateSpeed: -0.25,
        initialRotationY: -2,
      },
      ringLayers: {
        enabled: false,
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
        initialRotationY: -0.68,
      },
    },
    uiTransform: {
      offsetX: 0,
      offsetY: 0.5,
      offsetZ: 0,
      scale: 0.9,
    },
    earthTransform: {
      scale: 0.95,
    },
    bottomHud: {
      visible: true,
      opacity: 1,
      color: '#d8f5ff',
      brightness: 4,
      scale: 1.9,
      tiltDeg: -78.4,
      positionY: -1.7,
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

  function applyRingTextureUvSettings(
    material: THREE.ShaderMaterial,
    fitEnabled: boolean,
    offsetX: number,
    offsetY: number,
    scaleX: number,
    scaleY: number,
    rotation: number,
    flipX: boolean,
    flipY: boolean,
    swap: boolean,
  ) {
    material.uniforms.uUvFitEnabled.value = fitEnabled ? 1 : 0;
    material.uniforms.uUvOffset.value.set(offsetX, offsetY);
    material.uniforms.uUvScale.value.set(scaleX, scaleY);
    material.uniforms.uUvRotation.value = rotation;
    material.uniforms.uUvFlip.value.set(flipX ? -1 : 1, flipY ? -1 : 1);
    material.uniforms.uUvSwap.value = swap ? 1 : 0;
  }

  function getRingTextureFaceOpacity(faceKey: EarthRingTextureFaceKey) {
    switch (faceKey) {
      case 'face3':
        return debugData.materials.ringTextureFace3Visible ? debugData.materials.ringTexture1Opacity : 0;
      case 'face8':
        return debugData.materials.ringTextureFace8Visible ? debugData.materials.ringTexture2Opacity : 0;
      case 'face9':
        return debugData.materials.ringTextureFace9Visible ? debugData.materials.ringTexture1Opacity : 0;
    }
  }

  function isRingTextureFaceVisible(faceKey: EarthRingTextureFaceKey) {
    switch (faceKey) {
      case 'face3':
        return debugData.materials.ringTextureFace3Visible;
      case 'face8':
        return debugData.materials.ringTextureFace8Visible;
      case 'face9':
        return debugData.materials.ringTextureFace9Visible;
    }
  }

  function applyRingTextureFaceMaterialAssignments() {
    for (const faceKey of RING_TEXTURE_FACE_KEYS) {
      setRingFaceTextureMaterial(
        ring.scene,
        faceKey,
        isRingTextureFaceVisible(faceKey) ? ringTextureFaceMaterials[faceKey] : ringMaterial,
      );
    }
  }

  function applyMaterialDebugSettings() {
    applyRingTextureFaceMaterialAssignments();

    ringMaterial.color.set(debugData.materials.ringColor);
    applyRingUiMaterialOpacity(ringMaterial, debugData.materials.ringOpacity);
    ringMaterial.emissive.set(debugData.materials.ringEmissiveColor);
    ringMaterial.emissiveIntensity = debugData.materials.ringEmissiveIntensity;
    ringTextureFaceMaterials.face3.uniforms.uBaseColor.value.set(debugData.materials.ringColor);
    ringTextureFaceMaterials.face3.uniforms.uBaseOpacity.value = debugData.materials.ringOpacity;
    ringTextureFaceMaterials.face3.uniforms.uOpacity.value = getRingTextureFaceOpacity('face3');
    ringTextureFaceMaterials.face3.uniforms.uPanelOpacity.value = debugData.materials.ringTexturePanelOpacity;
    ringTextureFaceMaterials.face3.uniforms.uBrightness.value = debugData.materials.ringTexture1Brightness;
    applyRingTextureUvSettings(
      ringTextureFaceMaterials.face3,
      debugData.materials.ringTextureFace3UvFitEnabled,
      debugData.materials.ringTextureFace3UvOffsetX,
      debugData.materials.ringTextureFace3UvOffsetY,
      debugData.materials.ringTextureFace3UvScaleX,
      debugData.materials.ringTextureFace3UvScaleY,
      debugData.materials.ringTextureFace3UvRotation,
      debugData.materials.ringTextureFace3UvFlipX,
      debugData.materials.ringTextureFace3UvFlipY,
      debugData.materials.ringTextureFace3UvSwap,
    );
    ringTextureFaceMaterials.face3.needsUpdate = true;
    ringTextureFaceMaterials.face8.uniforms.uBaseColor.value.set(debugData.materials.ringColor);
    ringTextureFaceMaterials.face8.uniforms.uBaseOpacity.value = debugData.materials.ringOpacity;
    ringTextureFaceMaterials.face8.uniforms.uOpacity.value = getRingTextureFaceOpacity('face8');
    ringTextureFaceMaterials.face8.uniforms.uPanelOpacity.value = debugData.materials.ringTexturePanelOpacity;
    ringTextureFaceMaterials.face8.uniforms.uBrightness.value = debugData.materials.ringTexture2Brightness;
    applyRingTextureUvSettings(
      ringTextureFaceMaterials.face8,
      debugData.materials.ringTextureFace8UvFitEnabled,
      debugData.materials.ringTextureFace8UvOffsetX,
      debugData.materials.ringTextureFace8UvOffsetY,
      debugData.materials.ringTextureFace8UvScaleX,
      debugData.materials.ringTextureFace8UvScaleY,
      debugData.materials.ringTextureFace8UvRotation,
      debugData.materials.ringTextureFace8UvFlipX,
      debugData.materials.ringTextureFace8UvFlipY,
      debugData.materials.ringTextureFace8UvSwap,
    );
    ringTextureFaceMaterials.face8.needsUpdate = true;
    ringTextureFaceMaterials.face9.uniforms.uBaseColor.value.set(debugData.materials.ringColor);
    ringTextureFaceMaterials.face9.uniforms.uBaseOpacity.value = debugData.materials.ringOpacity;
    ringTextureFaceMaterials.face9.uniforms.uOpacity.value = getRingTextureFaceOpacity('face9');
    ringTextureFaceMaterials.face9.uniforms.uPanelOpacity.value = debugData.materials.ringTexturePanelOpacity;
    ringTextureFaceMaterials.face9.uniforms.uBrightness.value = debugData.materials.ringTexture1Brightness;
    applyRingTextureUvSettings(
      ringTextureFaceMaterials.face9,
      debugData.materials.ringTextureFace9UvFitEnabled,
      debugData.materials.ringTextureFace9UvOffsetX,
      debugData.materials.ringTextureFace9UvOffsetY,
      debugData.materials.ringTextureFace9UvScaleX,
      debugData.materials.ringTextureFace9UvScaleY,
      debugData.materials.ringTextureFace9UvRotation,
      debugData.materials.ringTextureFace9UvFlipX,
      debugData.materials.ringTextureFace9UvFlipY,
      debugData.materials.ringTextureFace9UvSwap,
    );
    ringTextureFaceMaterials.face9.needsUpdate = true;

    ringSideMaterial.color.set(debugData.materials.sideColor);
    applyRingUiMaterialOpacity(ringSideMaterial, debugData.materials.sideOpacity);
    ringSideMaterial.emissive.set(debugData.materials.sideEmissiveColor);
    ringSideMaterial.emissiveIntensity = debugData.materials.sideEmissiveIntensity;

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
    applyRingUiMaterialOpacity(ringMaterial, debugData.materials.ringOpacity * staging * focus);
    ringTextureFaceMaterials.face3.uniforms.uBaseOpacity.value = debugData.materials.ringOpacity * staging * focus;
    ringTextureFaceMaterials.face3.uniforms.uOpacity.value = getRingTextureFaceOpacity('face3') * staging * focus;
    ringTextureFaceMaterials.face3.uniforms.uPanelOpacity.value = debugData.materials.ringTexturePanelOpacity * staging * focus;
    ringTextureFaceMaterials.face8.uniforms.uBaseOpacity.value = debugData.materials.ringOpacity * staging * focus;
    ringTextureFaceMaterials.face8.uniforms.uOpacity.value = getRingTextureFaceOpacity('face8') * staging * focus;
    ringTextureFaceMaterials.face8.uniforms.uPanelOpacity.value = debugData.materials.ringTexturePanelOpacity * staging * focus;
    ringTextureFaceMaterials.face9.uniforms.uBaseOpacity.value = debugData.materials.ringOpacity * staging * focus;
    ringTextureFaceMaterials.face9.uniforms.uOpacity.value = getRingTextureFaceOpacity('face9') * staging * focus;
    ringTextureFaceMaterials.face9.uniforms.uPanelOpacity.value = debugData.materials.ringTexturePanelOpacity * staging * focus;
    ringMaterial.emissiveIntensity = debugData.materials.ringEmissiveIntensity * THREE.MathUtils.lerp(0.35, 1, staging);
    applyRingUiMaterialOpacity(ringSideMaterial, debugData.materials.sideOpacity * staging * focus);
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

  let earthPostPipeline: ScenePostPipeline | null = null;
  const earthScene = scene as ModelScene & EarthSceneDebugControls & ScenePostProcessable;
  earthScene.getPostPipeline = (renderer) => {
    if (!earthPostPipeline) {
      earthPostPipeline = new EarthPostPipeline(renderer, scene.scene, scene.camera, debugData.post);
    }
    return earthPostPipeline;
  };
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
