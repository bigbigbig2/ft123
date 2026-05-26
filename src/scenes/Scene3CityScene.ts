import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { ModelScene } from './ModelScene';
import type { SceneBase } from './SceneBase';
import { loadGLTF } from '../utils/loaders';

const SCENE3_MODEL_ROOT = '/models/scene3';
const BUILD_MODEL_URL = `${SCENE3_MODEL_ROOT}/build.gltf`;
const DRONE_MODEL_URL = `${SCENE3_MODEL_ROOT}/drone.gltf`;
const LEFT_CARD_VIDEO_URL = `${SCENE3_MODEL_ROOT}/left.webm`;
const RIGHT_CARD_VIDEO_URL = `${SCENE3_MODEL_ROOT}/right.webm`;
const ENVIRONMENT_MAP_URL = `${SCENE3_MODEL_ROOT}/tex/HDRI_STUDIO_vol2_003.exr`;
const BASE_NORMAL_MAP_URL = `${SCENE3_MODEL_ROOT}/tex/normal.jpg`;
const MODEL_DESIRED_SIZE = 3.45;
const WINDOW_NODE_KEYWORD = '\u7a97\u6237';
const BASE_NODE_NAMES = new Set(Array.from({ length: 9 }, (_, index) => String(index + 1)));
const SCAN_POINTS_PER_BEAM = 1800;
const SCAN_POINT_RENDER_ORDER = 24;
const VIDEO_CARD_RENDER_ORDER = 6;
const VIDEO_CARD_BLACK_CUTOFF = 0.025;
const VIDEO_CARD_BLACK_FEATHER = 0.14;
const VIDEO_CARD_BRIGHTNESS = 1.36;
const VIDEO_CARD_CONTRAST = 1.12;
const MODEL_ANIMATION_END_PROGRESS = 0.78;
const VIDEO_CARD_START_PROGRESS = 0.46;
const VIDEO_CARD_RESET_PROGRESS = VIDEO_CARD_START_PROGRESS - 0.12;

export interface Scene3MaterialDebugState {
  windowColor: string;
  windowOpacity: number;
  windowEmissiveColor: string;
  windowEmissiveIntensity: number;
  windowRoughness: number;
  bodyColor: string;
  bodyOpacity: number;
  bodyEmissiveColor: string;
  bodyEmissiveIntensity: number;
  bodyMetalness: number;
  bodyRoughness: number;
}

export interface Scene3DroneDebugState {
  scale: number;
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationYDeg: number;
}

export interface Scene3DebugData {
  materials: Scene3MaterialDebugState;
  lighting: Scene3LightingDebugState;
  drone: Scene3DroneDebugState;
  stage: Scene3StageDebugState;
  videoCards: Scene3VideoCardsDebugState;
  bounds: Scene3BoundsDebugState;
}

export interface Scene3LightingDebugState {
  environmentIntensity: number;
  ambientIntensity: number;
  keyIntensity: number;
  fillIntensity: number;
  rimIntensity: number;
  shadowsEnabled: boolean;
}

export interface Scene3StageDebugState {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationY: number;
  scale: number;
}

export interface Scene3VideoCardDebugState {
  visible: boolean;
  opacity: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  rotationXDeg: number;
  rotationYDeg: number;
  rotationZDeg: number;
  scale: number;
}

export interface Scene3VideoCardsDebugState {
  left: Scene3VideoCardDebugState;
  right: Scene3VideoCardDebugState;
}

export interface Scene3BoundsDebugState {
  visible: boolean;
  color: string;
  opacity: number;
}

export interface Scene3DebugScene extends SceneBase {
  getScene3DebugData(): Scene3DebugData;
  applyScene3Debug(): void;
  resetScene3Debug(): void;
}

interface Scene3AnimationController {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[];
  duration: number;
}

type Scene3VideoCardSide = 'left' | 'right';

interface Scene3VideoCard {
  side: Scene3VideoCardSide;
  state: Scene3VideoCardDebugState;
  root: THREE.Group;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  aspect: number;
}

function createScene3BaseNormalMap() {
  const texture = new THREE.TextureLoader().load(BASE_NORMAL_MAP_URL);
  texture.name = 'Scene3BaseNormalMap';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = 8;
  return texture;
}

function createScene3DebugData(): Scene3DebugData {
  return {
    materials: {
      windowColor: '#00467f',
      windowOpacity: 0.51,
      windowEmissiveColor: '#0390ff',
      windowEmissiveIntensity: 1.08,
      windowRoughness: 0.35,
      bodyColor: '#cccdcf',
      bodyOpacity: 1,
      bodyEmissiveColor: '#000000',
      bodyEmissiveIntensity: 0,
      bodyMetalness: 0.25,
      bodyRoughness: 0.64,
    },
    lighting: {
      environmentIntensity: 2.51,
      ambientIntensity: 0.72,
      keyIntensity: 3.86,
      fillIntensity: 0.2,
      rimIntensity: 1.96,
      shadowsEnabled: true,
    },
    drone: {
      scale: 2,
      positionX: -10,
      positionY: 630,
      positionZ: -10,
      rotationYDeg: 180,
    },
    stage: {
      positionX: 0,
      positionY: 1,
      positionZ: 0,
      rotationY: -0.28,
      scale: 0.9,
    },
    videoCards: {
      left: {
        visible: true,
        opacity: 0.86,
        offsetX: -30.4,
        offsetY: -40,
        offsetZ: 40,
        rotationXDeg: 0,
        rotationYDeg: 0,
        rotationZDeg: 0,
        scale: 1.8,
      },
      right: {
        visible: true,
        opacity: 0.86,
        offsetX: 4.3,
        offsetY: -40,
        offsetZ: -27.8,
        rotationXDeg: 0,
        rotationYDeg: 0,
        rotationZDeg: 0,
        scale: 1.3,
      },
    },
    bounds: {
      visible: false,
      color: '#d6f7ff',
      opacity: 0.72,
    },
  };
}

export class Scene3CityScene extends ModelScene {
  private readonly animationControllers: Scene3AnimationController[] = [];
  private readonly debugData = createScene3DebugData();
  private readonly environmentTexture: THREE.Texture | null;
  private readonly baseNormalMap = createScene3BaseNormalMap();
  private readonly scene3AmbientLight = new THREE.AmbientLight(0xb7c9ee, 0.22);
  private readonly scene3KeyLight = new THREE.DirectionalLight(0xf4fbff, 2.1);
  private readonly scene3FillLight = new THREE.DirectionalLight(0x86a9e8, 0.24);
  private readonly scene3RimLight = new THREE.DirectionalLight(0x8bd8ff, 1.85);
  private readonly windowMaterial = new THREE.MeshStandardMaterial({
    name: 'Scene3WindowBlueMaterial',
    color: this.debugData.materials.windowColor,
    emissive: this.debugData.materials.windowEmissiveColor,
    emissiveIntensity: this.debugData.materials.windowEmissiveIntensity,
    metalness: 0.05,
    roughness: this.debugData.materials.windowRoughness,
    envMapIntensity: this.debugData.lighting.environmentIntensity,
    transparent: true,
    opacity: this.debugData.materials.windowOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    name: 'Scene3BodyWhiteMaterial',
    color: this.debugData.materials.bodyColor,
    emissive: this.debugData.materials.bodyEmissiveColor,
    emissiveIntensity: this.debugData.materials.bodyEmissiveIntensity,
    metalness: this.debugData.materials.bodyMetalness,
    roughness: this.debugData.materials.bodyRoughness,
    envMapIntensity: this.debugData.lighting.environmentIntensity,
    transparent: false,
    opacity: this.debugData.materials.bodyOpacity,
    side: THREE.DoubleSide,
  });
  private readonly baseMaterial = new THREE.MeshStandardMaterial({
    name: 'Scene3BaseNormalMaterial',
    color: this.debugData.materials.bodyColor,
    emissive: this.debugData.materials.bodyEmissiveColor,
    emissiveIntensity: this.debugData.materials.bodyEmissiveIntensity,
    metalness: this.debugData.materials.bodyMetalness,
    roughness: this.debugData.materials.bodyRoughness,
    envMapIntensity: this.debugData.lighting.environmentIntensity,
    transparent: false,
    opacity: this.debugData.materials.bodyOpacity,
    normalMap: this.baseNormalMap,
    normalScale: new THREE.Vector2(0.72, 0.72),
    side: THREE.DoubleSide,
  });
  private readonly hiddenScanBeamMaterial = new THREE.MeshBasicMaterial({
    name: 'Scene3HiddenScanBeamMaterial',
    transparent: true,
    opacity: 0,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  private readonly scanPointMaterial = new THREE.PointsMaterial({
    name: 'Scene3ScanPointMaterial',
    size: 1.15,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.72,
    vertexColors: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  private readonly scanPointGeometries: THREE.BufferGeometry[] = [];
  private readonly cityBounds = new THREE.Box3();
  private readonly cityBoundsCenter = new THREE.Vector3();
  private readonly cityBoundsSize = new THREE.Vector3(1, 1, 1);
  private readonly boundsRigRoot = new THREE.Group();
  private readonly boundsFrameMaterial = new THREE.LineBasicMaterial({
    name: 'Scene3BoundsFrameMaterial',
    color: '#d6f7ff',
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  private boundsFrame: THREE.LineSegments | null = null;
  private readonly videoCardRoot = new THREE.Group();
  private readonly videoCards: Scene3VideoCard[] = [];
  private droneRoot: THREE.Object3D | null = null;
  private droneTransformRoot: THREE.Group | null = null;
  private sceneActive = false;
  private progress = 0;
  private videoCardsStarted = false;

  constructor(build: GLTF, drone: GLTF, environmentTexture?: THREE.Texture) {
    super({
      // Keep the timeline-facing name as scene1: visually this is Scene3.
      name: 'scene1',
      fov: 34,
      cameraPosition: [3.25, 2.15, 4.45],
      cameraLookAt: [0, 0.36, 0],
      autoRotate: false,
    });

    this.camera.near = 0.03;
    this.camera.far = 120;
    this.camera.updateProjectionMatrix();
    this.environmentTexture = environmentTexture ?? null;
    this.clearInheritedLights();
    if (this.environmentTexture) {
      this.scene.environment = this.environmentTexture;
    }

    const contentRoot = new THREE.Group();
    contentRoot.name = 'Scene3CityContent';
    this.droneRoot = drone.scene;
    this.droneTransformRoot = new THREE.Group();
    this.droneTransformRoot.name = 'Scene3DroneTransformRoot';
    this.droneTransformRoot.add(this.droneRoot);
    this.applyDroneDebug();

    contentRoot.add(build.scene);
    contentRoot.add(this.droneTransformRoot);

    this.configureAsset(build.scene);
    this.configureAsset(this.droneRoot);
    this.registerAnimations(build);
    this.registerAnimations(drone);
    this.updateCityBounds(contentRoot, build.scene);

    this.attachAndFit(contentRoot, MODEL_DESIRED_SIZE);
    this.boundsRigRoot.name = 'Scene3BoundsRig';
    this.boundsFrame = this.createBoundsFrame();
    this.boundsRigRoot.add(this.boundsFrame);
    this.videoCardRoot.name = 'Scene3VideoCards';
    this.boundsRigRoot.add(this.videoCardRoot);
    contentRoot.add(this.boundsRigRoot);
    this.videoCards.push(
      this.createVideoCard('left', LEFT_CARD_VIDEO_URL, this.debugData.videoCards.left),
      this.createVideoCard('right', RIGHT_CARD_VIDEO_URL, this.debugData.videoCards.right),
    );

    this.addSceneAccentLights();
    this.applyScene3Debug();
    this.setProgress(0);
  }

  setActive(active: boolean) {
    super.setActive(active);
    this.sceneActive = active;

    this.syncVideoCardPlayback();
  }

  setProgress(progress: number) {
    this.progress = THREE.MathUtils.clamp(progress, 0, 1);
    this.applyAnimationProgress();
    this.syncVideoCardPlayback();
    this.applyVideoCardDebug();
  }

  update(delta: number, elapsed: number) {
    super.update(delta, elapsed);
    this.applyAnimationProgress();
  }

  dispose() {
    for (const controller of this.animationControllers) {
      controller.mixer.stopAllAction();
      controller.mixer.uncacheRoot(controller.root);
    }

    this.windowMaterial.dispose();
    this.bodyMaterial.dispose();
    this.baseMaterial.dispose();
    this.baseNormalMap.dispose();
    if (this.scene.environment === this.environmentTexture) {
      this.scene.environment = null;
    }
    this.environmentTexture?.dispose();
    this.hiddenScanBeamMaterial.dispose();
    this.scanPointMaterial.dispose();
    this.scanPointGeometries.forEach((geometry) => geometry.dispose());
    this.boundsFrameMaterial.dispose();
    this.boundsFrame?.geometry.dispose();
    this.videoCards.forEach((card) => this.disposeVideoCard(card));
    super.dispose();
  }

  getScene3DebugData() {
    return this.debugData;
  }

  applyScene3Debug() {
    this.applyMaterialDebug();
    this.applyLightingDebug();
    this.applyDroneDebug();
    this.applyStageDebug();
    this.applyBoundsDebug();
    this.applyVideoCardDebug();
  }

  resetScene3Debug() {
    const defaults = createScene3DebugData();
    Object.assign(this.debugData.materials, defaults.materials);
    Object.assign(this.debugData.lighting, defaults.lighting);
    Object.assign(this.debugData.drone, defaults.drone);
    Object.assign(this.debugData.stage, defaults.stage);
    Object.assign(this.debugData.videoCards.left, defaults.videoCards.left);
    Object.assign(this.debugData.videoCards.right, defaults.videoCards.right);
    Object.assign(this.debugData.bounds, defaults.bounds);
    this.applyScene3Debug();
  }

  private createVideoCard(
    side: Scene3VideoCardSide,
    url: string,
    state: Scene3VideoCardDebugState,
  ): Scene3VideoCard {
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.loop = false;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.pause();

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    texture.generateMipmaps = false;

    const material = new THREE.ShaderMaterial({
      name: `Scene3${side}VideoCardMaterial`,
      uniforms: {
        uMap: { value: texture },
        uOpacity: { value: state.opacity },
        uBlackCutoff: { value: VIDEO_CARD_BLACK_CUTOFF },
        uBlackFeather: { value: VIDEO_CARD_BLACK_FEATHER },
        uBrightness: { value: VIDEO_CARD_BRIGHTNESS },
        uContrast: { value: VIDEO_CARD_CONTRAST },
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uOpacity;
        uniform float uBlackCutoff;
        uniform float uBlackFeather;
        uniform float uBrightness;
        uniform float uContrast;

        varying vec2 vUv;

        void main() {
          vec4 texel = texture2D(uMap, vUv);
          float luminance = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
          float matte = smoothstep(uBlackCutoff, uBlackCutoff + uBlackFeather, luminance);
          vec3 color = (texel.rgb - 0.5) * uContrast + 0.5;
          color = max(color, vec3(0.0)) * uBrightness;
          float alpha = uOpacity * texel.a * matte;

          if (alpha < 0.01) discard;

          gl_FragColor = vec4(color, alpha);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    material.forceSinglePass = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.name = `Scene3${side}VideoCardMesh`;
    mesh.frustumCulled = false;
    mesh.renderOrder = VIDEO_CARD_RENDER_ORDER;

    const root = new THREE.Group();
    root.name = `Scene3${side}VideoCard`;
    root.add(mesh);
    this.videoCardRoot.add(root);

    const card: Scene3VideoCard = {
      side,
      state,
      root,
      mesh,
      video,
      texture,
      aspect: 16 / 9,
    };

    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        card.aspect = video.videoWidth / video.videoHeight;
        this.applyVideoCardTransform(card);
      }
    });
    video.addEventListener('ended', () => {
      video.pause();
    });

    return card;
  }

  private disposeVideoCard(card: Scene3VideoCard) {
    card.video.pause();
    card.video.removeAttribute('src');
    card.video.load();
    card.texture.dispose();
    card.mesh.geometry.dispose();
    card.mesh.material.dispose();
  }

  private updateCityBounds(boundsSpaceRoot: THREE.Object3D, cityRoot: THREE.Object3D) {
    boundsSpaceRoot.updateMatrixWorld(true);
    cityRoot.updateMatrixWorld(true);
    this.cityBounds.makeEmpty();
    this.expandBoundsFromLocalGeometry(boundsSpaceRoot, cityRoot);

    if (this.cityBounds.isEmpty()) {
      this.cityBounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(2, 2, 2));
    }

    this.cityBounds.getCenter(this.cityBoundsCenter);
    this.cityBounds.getSize(this.cityBoundsSize);
  }

  private expandBoundsFromLocalGeometry(root: THREE.Object3D, object: THREE.Object3D) {
    const mesh = object as THREE.Mesh;

    if (mesh.isMesh && mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();

      const geometryBox = mesh.geometry.boundingBox;
      if (geometryBox) {
        const matrix = new THREE.Matrix4()
          .copy(root.matrixWorld)
          .invert()
          .multiply(mesh.matrixWorld);
        const localBox = geometryBox.clone().applyMatrix4(matrix);
        this.cityBounds.union(localBox);
      }
    }

    for (const child of object.children) {
      this.expandBoundsFromLocalGeometry(root, child);
    }
  }

  private createBoundsFrame() {
    const min = this.cityBounds.min;
    const max = this.cityBounds.max;
    const corners = [
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(max.x, min.y, min.z),
      new THREE.Vector3(max.x, min.y, max.z),
      new THREE.Vector3(min.x, min.y, max.z),
      new THREE.Vector3(min.x, max.y, min.z),
      new THREE.Vector3(max.x, max.y, min.z),
      new THREE.Vector3(max.x, max.y, max.z),
      new THREE.Vector3(min.x, max.y, max.z),
    ];
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const positions = new Float32Array(edges.length * 2 * 3);
    let cursor = 0;

    for (const [aIndex, bIndex] of edges) {
      const a = corners[aIndex]!;
      const b = corners[bIndex]!;
      positions[cursor++] = a.x;
      positions[cursor++] = a.y;
      positions[cursor++] = a.z;
      positions[cursor++] = b.x;
      positions[cursor++] = b.y;
      positions[cursor++] = b.z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const frame = new THREE.LineSegments(geometry, this.boundsFrameMaterial);
    frame.name = 'Scene3CityBoundsFrame';
    frame.frustumCulled = false;
    frame.renderOrder = 20;
    return frame;
  }

  private registerAnimations(gltf: GLTF) {
    if (gltf.animations.length === 0) return;

    const mixer = new THREE.AnimationMixer(gltf.scene);
    const actions: THREE.AnimationAction[] = [];
    let duration = 0;

    for (const clip of gltf.animations) {
      duration = Math.max(duration, clip.duration);
      const action = mixer.clipAction(clip);
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.enabled = true;
      action.setEffectiveWeight(1);
      action.play();
      actions.push(action);
    }

    this.animationControllers.push({
      root: gltf.scene,
      mixer,
      actions,
      duration,
    });
  }

  private applyAnimationProgress() {
    const animationProgress = THREE.MathUtils.clamp(
      this.progress / MODEL_ANIMATION_END_PROGRESS,
      0,
      1,
    );

    for (const controller of this.animationControllers) {
      if (controller.duration <= 0) continue;
      for (const action of controller.actions) {
        action.paused = false;
        action.enabled = true;
      }
      controller.mixer.setTime(controller.duration * animationProgress);
    }
  }

  private syncVideoCardPlayback() {
    if (this.progress < VIDEO_CARD_RESET_PROGRESS) {
      this.videoCardsStarted = false;
      for (const card of this.videoCards) {
        this.resetVideoCard(card);
      }
      return;
    }

    if (!this.sceneActive || this.progress < VIDEO_CARD_START_PROGRESS) {
      for (const card of this.videoCards) {
        card.video.pause();
      }
      return;
    }

    if (!this.videoCardsStarted) {
      this.videoCardsStarted = true;
      for (const card of this.videoCards) {
        this.startVideoCard(card);
      }
      return;
    }

    for (const card of this.videoCards) {
      if (!card.video.ended && card.video.paused) {
        card.video.play().catch(() => {});
      }
    }
  }

  private startVideoCard(card: Scene3VideoCard) {
    try {
      card.video.currentTime = 0;
    } catch {
      // Some browsers reject seeking before metadata is ready; play() will still begin at the first frame.
    }

    card.video.play().catch(() => {});
  }

  private resetVideoCard(card: Scene3VideoCard) {
    card.video.pause();
    try {
      card.video.currentTime = 0;
    } catch {
      // The next trigger will restart from the beginning once the video is ready.
    }
  }

  private configureAsset(root: THREE.Object3D) {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.frustumCulled = false;
      this.configureMeshMaterial(mesh);
    });
  }

  private configureMeshMaterial(mesh: THREE.Mesh) {
    if (BASE_NODE_NAMES.has(mesh.name)) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.material = this.baseMaterial;
      return;
    }

    if (this.isNamedInHierarchy(mesh, WINDOW_NODE_KEYWORD)) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.material = this.windowMaterial;
      return;
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const isLaser = materials.some((material) => material.name.toLowerCase().includes('laser'))
      || this.isNamedInHierarchyLower(mesh, ['laser', 'loft']);

    if (isLaser) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.replaceScanBeamWithPoints(mesh);
      return;
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.material = this.bodyMaterial;
  }

  private replaceScanBeamWithPoints(mesh: THREE.Mesh) {
    if (mesh.userData.scene3ScanPoints) return;

    const pointsGeometry = this.createScanPointGeometry(mesh.geometry);
    const points = new THREE.Points(pointsGeometry, this.scanPointMaterial);
    points.name = `${mesh.name || 'scanBeam'}_scan_points`;
    points.frustumCulled = false;
    points.renderOrder = SCAN_POINT_RENDER_ORDER;

    mesh.add(points);
    mesh.material = this.hiddenScanBeamMaterial;
    mesh.renderOrder = 7;
    mesh.userData.scene3ScanPoints = points;
    this.scanPointGeometries.push(pointsGeometry);
  }

  private createScanPointGeometry(sourceGeometry: THREE.BufferGeometry) {
    const position = sourceGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const pointGeometry = new THREE.BufferGeometry();

    if (!position || position.count < 3) return pointGeometry;

    const triangles = this.collectGeometryTriangles(sourceGeometry, position);
    const positions = new Float32Array(SCAN_POINTS_PER_BEAM * 3);
    const colors = new Float32Array(SCAN_POINTS_PER_BEAM * 3);
    const centroid = new THREE.Vector3();

    triangles.forEach((triangle) => {
      centroid.add(triangle.a).add(triangle.b).add(triangle.c);
    });
    centroid.multiplyScalar(1 / Math.max(1, triangles.length * 3));

    let seed = position.count * 1103515245 + 12345;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967295;
    };

    for (let i = 0; i < SCAN_POINTS_PER_BEAM; i += 1) {
      const triangle = triangles[Math.floor(random() * triangles.length)] ?? triangles[0]!;
      const point = this.sampleTrianglePoint(triangle, random(), random());
      point.lerp(centroid, Math.pow(random(), 1.7) * 0.46);

      const jitter = 0.0035;
      point.x += (random() - 0.5) * jitter;
      point.y += (random() - 0.5) * jitter;
      point.z += (random() - 0.5) * jitter;

      const offset = i * 3;
      positions[offset] = point.x;
      positions[offset + 1] = point.y;
      positions[offset + 2] = point.z;

      const tint = 0.72 + random() * 0.28;
      colors[offset] = 0.78 * tint;
      colors[offset + 1] = 0.96 * tint;
      colors[offset + 2] = 1;
    }

    pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return pointGeometry;
  }

  private collectGeometryTriangles(sourceGeometry: THREE.BufferGeometry, position: THREE.BufferAttribute) {
    const index = sourceGeometry.getIndex();
    const triangles: THREE.Triangle[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();

    const pushTriangle = (ia: number, ib: number, ic: number) => {
      a.fromBufferAttribute(position, ia);
      b.fromBufferAttribute(position, ib);
      c.fromBufferAttribute(position, ic);
      if (new THREE.Triangle(a, b, c).getArea() <= 0.000001) return;
      triangles.push(new THREE.Triangle(a.clone(), b.clone(), c.clone()));
    };

    if (index) {
      for (let i = 0; i < index.count - 2; i += 3) {
        pushTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
    } else {
      for (let i = 0; i < position.count - 2; i += 3) {
        pushTriangle(i, i + 1, i + 2);
      }
    }

    if (triangles.length === 0) {
      const box = new THREE.Box3().setFromBufferAttribute(position);
      const min = box.min;
      const max = box.max;
      triangles.push(new THREE.Triangle(
        new THREE.Vector3(min.x, min.y, min.z),
        new THREE.Vector3(max.x, min.y, max.z),
        new THREE.Vector3((min.x + max.x) * 0.5, max.y, (min.z + max.z) * 0.5),
      ));
    }

    return triangles;
  }

  private sampleTrianglePoint(triangle: THREE.Triangle, r1: number, r2: number) {
    const sr1 = Math.sqrt(r1);
    const aWeight = 1 - sr1;
    const bWeight = sr1 * (1 - r2);
    const cWeight = sr1 * r2;

    return new THREE.Vector3()
      .addScaledVector(triangle.a, aWeight)
      .addScaledVector(triangle.b, bWeight)
      .addScaledVector(triangle.c, cWeight);
  }

  private isNamedInHierarchy(object: THREE.Object3D, keyword: string) {
    let cursor: THREE.Object3D | null = object;
    while (cursor) {
      if (cursor.name.includes(keyword)) return true;
      cursor = cursor.parent;
    }

    return false;
  }

  private isNamedInHierarchyLower(object: THREE.Object3D, keywords: string[]) {
    let cursor: THREE.Object3D | null = object;
    while (cursor) {
      const name = cursor.name.toLowerCase();
      if (keywords.some((keyword) => name.includes(keyword))) return true;
      cursor = cursor.parent;
    }

    return false;
  }

  private applyMaterialDebug() {
    const { materials } = this.debugData;
    const { lighting } = this.debugData;

    this.windowMaterial.color.set(materials.windowColor);
    this.windowMaterial.opacity = materials.windowOpacity;
    this.windowMaterial.emissive.set(materials.windowEmissiveColor);
    this.windowMaterial.emissiveIntensity = materials.windowEmissiveIntensity;
    this.windowMaterial.roughness = materials.windowRoughness;
    this.windowMaterial.envMapIntensity = lighting.environmentIntensity;
    this.windowMaterial.transparent = materials.windowOpacity < 1;
    this.windowMaterial.depthWrite = materials.windowOpacity >= 1;
    this.windowMaterial.needsUpdate = true;

    this.bodyMaterial.color.set(materials.bodyColor);
    this.bodyMaterial.opacity = materials.bodyOpacity;
    this.bodyMaterial.emissive.set(materials.bodyEmissiveColor);
    this.bodyMaterial.emissiveIntensity = materials.bodyEmissiveIntensity;
    this.bodyMaterial.metalness = materials.bodyMetalness;
    this.bodyMaterial.roughness = materials.bodyRoughness;
    this.bodyMaterial.envMapIntensity = lighting.environmentIntensity;
    this.bodyMaterial.transparent = materials.bodyOpacity < 1;
    this.bodyMaterial.depthWrite = materials.bodyOpacity >= 1;
    this.bodyMaterial.needsUpdate = true;

    this.baseMaterial.color.set(materials.bodyColor);
    this.baseMaterial.opacity = materials.bodyOpacity;
    this.baseMaterial.emissive.set(materials.bodyEmissiveColor);
    this.baseMaterial.emissiveIntensity = materials.bodyEmissiveIntensity;
    this.baseMaterial.metalness = materials.bodyMetalness;
    this.baseMaterial.roughness = materials.bodyRoughness;
    this.baseMaterial.envMapIntensity = lighting.environmentIntensity;
    this.baseMaterial.transparent = materials.bodyOpacity < 1;
    this.baseMaterial.depthWrite = materials.bodyOpacity >= 1;
    this.baseMaterial.needsUpdate = true;
  }

  private applyDroneDebug() {
    if (!this.droneTransformRoot) return;

    const { drone } = this.debugData;
    this.droneTransformRoot.scale.setScalar(drone.scale);
    this.droneTransformRoot.position.set(drone.positionX, drone.positionY, drone.positionZ);
    this.droneTransformRoot.rotation.y = THREE.MathUtils.degToRad(drone.rotationYDeg);
  }

  private applyLightingDebug() {
    const { lighting } = this.debugData;
    this.scene.environmentIntensity = lighting.environmentIntensity;
    this.scene3AmbientLight.intensity = lighting.ambientIntensity;
    this.scene3KeyLight.intensity = lighting.keyIntensity;
    this.scene3FillLight.intensity = lighting.fillIntensity;
    this.scene3RimLight.intensity = lighting.rimIntensity;
    this.scene3KeyLight.castShadow = lighting.shadowsEnabled;
  }

  private applyStageDebug() {
    const { stage } = this.debugData;
    this.modelRoot.position.set(stage.positionX, stage.positionY, stage.positionZ);
    this.modelRoot.rotation.y = stage.rotationY;
    this.modelRoot.scale.setScalar(stage.scale);
  }

  private applyBoundsDebug() {
    const { bounds } = this.debugData;
    if (this.boundsFrame) this.boundsFrame.visible = bounds.visible;
    this.boundsFrameMaterial.color.set(bounds.color);
    this.boundsFrameMaterial.opacity = bounds.opacity;
    this.boundsFrameMaterial.needsUpdate = true;
  }

  private applyVideoCardDebug() {
    for (const card of this.videoCards) {
      this.applyVideoCardTransform(card);
    }
  }

  private applyVideoCardTransform(card: Scene3VideoCard) {
    const { state } = card;
    const reveal = this.videoCardsStarted ? 1 : 0;
    const opacity = state.visible ? state.opacity * reveal : 0;
    const cardHeight = Math.max(0.36, this.cityBoundsSize.y * 0.18) * state.scale;
    const cardWidth = card.aspect * cardHeight;
    const basePlacement = this.getVideoCardBoundsPlacement(card.side, cardWidth);

    card.root.visible = state.visible && opacity > 0.001;
    card.root.position.set(
      basePlacement.position.x + state.offsetX,
      basePlacement.position.y + state.offsetY,
      basePlacement.position.z + state.offsetZ,
    );
    card.root.rotation.set(0, basePlacement.rotationY, 0);
    card.root.rotateX(THREE.MathUtils.degToRad(state.rotationXDeg));
    card.root.rotateY(THREE.MathUtils.degToRad(state.rotationYDeg));
    card.root.rotateZ(THREE.MathUtils.degToRad(state.rotationZDeg));
    card.mesh.scale.set(cardWidth, cardHeight, 1);
    card.mesh.material.uniforms.uOpacity.value = opacity;
  }

  private getVideoCardBoundsPlacement(side: Scene3VideoCardSide, cardWidth: number) {
    const sideInset = Math.max(0.04, this.cityBoundsSize.x * 0.05);
    const depthInset = Math.max(0.04, this.cityBoundsSize.z * 0.05);
    const faceOffset = Math.max(0.02, Math.min(this.cityBoundsSize.x, this.cityBoundsSize.z) * 0.025);
    const y = this.cityBounds.min.y + this.cityBoundsSize.y * 0.48;

    if (side === 'left') {
      return {
        position: new THREE.Vector3(
          this.cityBounds.min.x - faceOffset,
          y,
          this.cityBounds.min.z + depthInset + cardWidth * 0.5,
        ),
        rotationY: Math.PI / 2,
      };
    }

    return {
      position: new THREE.Vector3(
        this.cityBounds.max.x - sideInset - cardWidth * 0.5,
        y,
        this.cityBounds.min.z - faceOffset,
      ),
      rotationY: 0,
    };
  }

  private addSceneAccentLights() {
    this.scene3AmbientLight.name = 'Scene3AmbientLight';

    this.scene3KeyLight.name = 'Scene3KeyLight';
    this.scene3KeyLight.position.set(-3.8, 5.2, 4.1);
    this.scene3KeyLight.castShadow = true;
    this.scene3KeyLight.shadow.mapSize.set(2048, 2048);
    this.scene3KeyLight.shadow.bias = -0.00018;
    this.scene3KeyLight.shadow.normalBias = 0.035;
    this.scene3KeyLight.shadow.camera.near = 0.1;
    this.scene3KeyLight.shadow.camera.far = 18;
    this.scene3KeyLight.shadow.camera.left = -5;
    this.scene3KeyLight.shadow.camera.right = 5;
    this.scene3KeyLight.shadow.camera.top = 5;
    this.scene3KeyLight.shadow.camera.bottom = -5;

    this.scene3FillLight.name = 'Scene3FillLight';
    this.scene3FillLight.position.set(3.5, 2.1, 3.2);

    this.scene3RimLight.name = 'Scene3BlueRimLight';
    this.scene3RimLight.position.set(4.3, 3.8, -3.5);

    this.scene.add(this.scene3AmbientLight);
    this.scene.add(this.scene3KeyLight);
    this.scene.add(this.scene3FillLight);
    this.scene.add(this.scene3RimLight);
    this.applyLightingDebug();
  }

  private clearInheritedLights() {
    const inheritedLights = this.scene.children.filter((child) => (child as THREE.Light).isLight);
    inheritedLights.forEach((light) => this.scene.remove(light));
  }
}

export async function createScene3CityScene() {
  const exrLoader = new EXRLoader();
  const [build, drone, environmentTexture] = await Promise.all([
    loadGLTF(BUILD_MODEL_URL),
    loadGLTF(DRONE_MODEL_URL),
    exrLoader.loadAsync(ENVIRONMENT_MAP_URL),
  ]);
  environmentTexture.name = 'Scene3EnvironmentMap';
  environmentTexture.mapping = THREE.EquirectangularReflectionMapping;

  return new Scene3CityScene(build, drone, environmentTexture);
}

export function isScene3DebugScene(scene: SceneBase): scene is Scene3DebugScene {
  return typeof (scene as Partial<Scene3DebugScene>).getScene3DebugData === 'function';
}
