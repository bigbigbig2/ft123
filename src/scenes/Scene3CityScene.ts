import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ModelScene } from './ModelScene';
import type { SceneBase } from './SceneBase';
import { loadGLTF } from '../utils/loaders';

const SCENE3_MODEL_ROOT = '/models/scene3';
const BUILD_MODEL_URL = `${SCENE3_MODEL_ROOT}/build.gltf`;
const DRONE_MODEL_URL = `${SCENE3_MODEL_ROOT}/drone.gltf`;
const MODEL_DESIRED_SIZE = 3.45;
const WINDOW_NODE_KEYWORD = '\u7a97\u6237';
const SCAN_POINTS_PER_BEAM = 1800;

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
  drone: Scene3DroneDebugState;
  stage: Scene3StageDebugState;
}

export interface Scene3StageDebugState {
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationY: number;
  scale: number;
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

function createScene3DebugData(): Scene3DebugData {
  return {
    materials: {
      windowColor: '#00467f',
      windowOpacity: 0.51,
      windowEmissiveColor: '#0390ff',
      windowEmissiveIntensity: 1.08,
      windowRoughness: 0.35,
      bodyColor: '#b8bbc2',
      bodyOpacity: 1,
      bodyEmissiveColor: '#000000',
      bodyEmissiveIntensity: 0,
      bodyMetalness: 0.13,
      bodyRoughness: 0.59,
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
  };
}

export class Scene3CityScene extends ModelScene {
  private readonly animationControllers: Scene3AnimationController[] = [];
  private readonly debugData = createScene3DebugData();
  private readonly windowMaterial = new THREE.MeshStandardMaterial({
    name: 'Scene3WindowBlueMaterial',
    color: this.debugData.materials.windowColor,
    emissive: this.debugData.materials.windowEmissiveColor,
    emissiveIntensity: this.debugData.materials.windowEmissiveIntensity,
    metalness: 0.05,
    roughness: this.debugData.materials.windowRoughness,
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
    transparent: false,
    opacity: this.debugData.materials.bodyOpacity,
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
  private droneRoot: THREE.Object3D | null = null;
  private droneTransformRoot: THREE.Group | null = null;
  private progress = 0;

  constructor(build: GLTF, drone: GLTF) {
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

    this.attachAndFit(contentRoot, MODEL_DESIRED_SIZE);
    this.addSceneAccentLights();
    this.applyScene3Debug();
    this.setProgress(0);
  }

  setProgress(progress: number) {
    this.progress = THREE.MathUtils.clamp(progress, 0, 1);
    this.applyAnimationProgress();
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
    this.hiddenScanBeamMaterial.dispose();
    this.scanPointMaterial.dispose();
    this.scanPointGeometries.forEach((geometry) => geometry.dispose());
    super.dispose();
  }

  getScene3DebugData() {
    return this.debugData;
  }

  applyScene3Debug() {
    this.applyMaterialDebug();
    this.applyDroneDebug();
    this.applyStageDebug();
  }

  resetScene3Debug() {
    const defaults = createScene3DebugData();
    Object.assign(this.debugData.materials, defaults.materials);
    Object.assign(this.debugData.drone, defaults.drone);
    Object.assign(this.debugData.stage, defaults.stage);
    this.applyScene3Debug();
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
    for (const controller of this.animationControllers) {
      if (controller.duration <= 0) continue;
      for (const action of controller.actions) {
        action.paused = false;
        action.enabled = true;
      }
      controller.mixer.setTime(controller.duration * this.progress);
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
    if (this.isNamedInHierarchy(mesh, WINDOW_NODE_KEYWORD)) {
      mesh.material = this.windowMaterial;
      return;
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const isLaser = materials.some((material) => material.name.toLowerCase().includes('laser'))
      || this.isNamedInHierarchyLower(mesh, ['laser', 'loft']);

    if (isLaser) {
      this.replaceScanBeamWithPoints(mesh);
      return;
    }

    mesh.material = this.bodyMaterial;
  }

  private replaceScanBeamWithPoints(mesh: THREE.Mesh) {
    if (mesh.userData.scene3ScanPoints) return;

    const pointsGeometry = this.createScanPointGeometry(mesh.geometry);
    const points = new THREE.Points(pointsGeometry, this.scanPointMaterial);
    points.name = `${mesh.name || 'scanBeam'}_scan_points`;
    points.frustumCulled = false;
    points.renderOrder = 8;

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

    this.windowMaterial.color.set(materials.windowColor);
    this.windowMaterial.opacity = materials.windowOpacity;
    this.windowMaterial.emissive.set(materials.windowEmissiveColor);
    this.windowMaterial.emissiveIntensity = materials.windowEmissiveIntensity;
    this.windowMaterial.roughness = materials.windowRoughness;
    this.windowMaterial.transparent = materials.windowOpacity < 1;
    this.windowMaterial.depthWrite = materials.windowOpacity >= 1;
    this.windowMaterial.needsUpdate = true;

    this.bodyMaterial.color.set(materials.bodyColor);
    this.bodyMaterial.opacity = materials.bodyOpacity;
    this.bodyMaterial.emissive.set(materials.bodyEmissiveColor);
    this.bodyMaterial.emissiveIntensity = materials.bodyEmissiveIntensity;
    this.bodyMaterial.metalness = materials.bodyMetalness;
    this.bodyMaterial.roughness = materials.bodyRoughness;
    this.bodyMaterial.transparent = materials.bodyOpacity < 1;
    this.bodyMaterial.depthWrite = materials.bodyOpacity >= 1;
    this.bodyMaterial.needsUpdate = true;
  }

  private applyDroneDebug() {
    if (!this.droneTransformRoot) return;

    const { drone } = this.debugData;
    this.droneTransformRoot.scale.setScalar(drone.scale);
    this.droneTransformRoot.position.set(drone.positionX, drone.positionY, drone.positionZ);
    this.droneTransformRoot.rotation.y = THREE.MathUtils.degToRad(drone.rotationYDeg);
  }

  private applyStageDebug() {
    const { stage } = this.debugData;
    this.modelRoot.position.set(stage.positionX, stage.positionY, stage.positionZ);
    this.modelRoot.rotation.y = stage.rotationY;
    this.modelRoot.scale.setScalar(stage.scale);
  }

  private addSceneAccentLights() {
    const frontFill = new THREE.DirectionalLight(0xd8ecff, 1.1);
    frontFill.position.set(-2.8, 2.2, 3.6);
    this.scene.add(frontFill);

    const blueRim = new THREE.DirectionalLight(0x77baff, 1.35);
    blueRim.position.set(3.5, 3.1, -2.2);
    this.scene.add(blueRim);
  }
}

export async function createScene3CityScene() {
  const [build, drone] = await Promise.all([
    loadGLTF(BUILD_MODEL_URL),
    loadGLTF(DRONE_MODEL_URL),
  ]);

  return new Scene3CityScene(build, drone);
}

export function isScene3DebugScene(scene: SceneBase): scene is Scene3DebugScene {
  return typeof (scene as Partial<Scene3DebugScene>).getScene3DebugData === 'function';
}
