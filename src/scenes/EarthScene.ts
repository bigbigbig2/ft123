import * as THREE from 'three';
import { ModelScene } from './ModelScene';
import type { SceneScrollState } from './SceneBase';
import { createProceduralEarth } from './earth/createEarthModel';
import { getEarthTimeline, type EarthTimeline } from './earth/earthTimeline';
import { moveBoxCenterTo, normalizeText, setMaterial } from './earth/earthSceneUtils';
import { loadGLTF } from '../utils/loaders';

const EARTH_MODEL_ROOT = '/models/%E5%9C%B0%E7%90%83%E9%A1%B5%E9%9D%A2%E6%A8%A1%E5%9E%8B';

function createRingMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: '#d8fbff',
    emissive: '#8ff8ff',
    emissiveIntensity: 0.26,
    transmission: 0.7,
    thickness: 0.08,
    transparent: true,
    opacity: 0.14,
    roughness: 0.08,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export async function createEarthScene() {
  const scene = new ModelScene({
    name: 'earth',
    fov: 31,
    cameraPosition: [0, 0.35, 4.25],
    cameraLookAt: [0, 0.02, 0],
    autoRotateSpeed: 0.045,
  });

  const [earth, ring, text] = await Promise.all([
    createProceduralEarth(),
    loadGLTF(`${EARTH_MODEL_ROOT}/huan.gltf`),
    loadGLTF(`${EARTH_MODEL_ROOT}/wenzi.gltf`),
  ]);

  const hemiLight = scene.scene.children.find((child) => child instanceof THREE.HemisphereLight);
  if (hemiLight) scene.scene.remove(hemiLight);

  const sun = new THREE.DirectionalLight('#ffffff', 1.0);
  sun.position.copy(earth.sunDirection).multiplyScalar(6);
  scene.scene.add(sun);

  const ringMaterial = createRingMaterial();
  setMaterial(ring.scene, ringMaterial);
  const textMaterials = normalizeText(text.scene);

  earth.group.scale.setScalar(1.2);
  ring.scene.scale.setScalar(0.92);
  text.scene.scale.setScalar(0.92);
  moveBoxCenterTo(earth.group, new THREE.Vector3(0, 0.2, 0));
  moveBoxCenterTo(ring.scene, new THREE.Vector3(0, -0.1, 0));
  moveBoxCenterTo(text.scene, new THREE.Vector3(0, -0.09, 0));
  ring.scene.visible = false;
  text.scene.visible = false;

  const root = new THREE.Group();
  root.name = 'earth-model-root';
  root.add(earth.group, ring.scene, text.scene);
  scene.attachAndFit(root, 3.0);

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
  const cameraLookAt = new THREE.Vector3();
  const setBaseScrollState = scene.setScrollState.bind(scene);
  const earthSettings = {
    ringOpacity: 0.14,
    ringEmissiveIntensity: 0.26,
  };

  const applyCameraTimeline = ({ pullBack }: EarthTimeline) => {
    scene.camera.position.set(
      THREE.MathUtils.lerp(0.08, baseCameraPosition.x, pullBack),
      THREE.MathUtils.lerp(0.12, baseCameraPosition.y, pullBack),
      THREE.MathUtils.lerp(2.08, baseCameraPosition.z, pullBack),
    );
    scene.camera.fov = THREE.MathUtils.lerp(38, baseCameraFov, pullBack);
    scene.camera.updateProjectionMatrix();
    cameraLookAt.set(0, THREE.MathUtils.lerp(0.58, 0.02, pullBack), 0);
    scene.camera.lookAt(cameraLookAt);
  };

  const applyModelTimeline = ({ liftProgress, pullBack, scrollSpin, spinComplete }: EarthTimeline) => {
    scene.modelRoot.position.y = baseModelY + THREE.MathUtils.lerp(-1.6, 0, liftProgress);
    scene.modelRoot.scale.setScalar(baseModelScale * THREE.MathUtils.lerp(1.62, 1, pullBack));
    scene.modelRoot.rotation.x = THREE.MathUtils.lerp(0.32, baseModelRotationX, pullBack);
    root.rotation.y = THREE.MathUtils.lerp(-0.22, 0.08, pullBack);
    earth.group.rotation.y = scrollSpin;
    scene.setAutoRotate(spinComplete);
  };

  const applyStageTimeline = ({ staging, textReveal, focus }: EarthTimeline) => {
    ring.scene.visible = staging > 0.001 && focus > 0.001;
    text.scene.visible = textReveal > 0.001 && focus > 0.001;
    ring.scene.position.y = baseRingPosition.y + THREE.MathUtils.lerp(-0.16, 0, staging);
    text.scene.position.y = baseTextPosition.y + THREE.MathUtils.lerp(-0.1, 0, textReveal);
    ring.scene.scale.setScalar(baseRingScale * THREE.MathUtils.lerp(0.9, 1, staging));
    text.scene.scale.setScalar(baseTextScale * THREE.MathUtils.lerp(0.96, 1, textReveal));

    ringMaterial.opacity = earthSettings.ringOpacity * staging * focus;
    ringMaterial.emissiveIntensity = earthSettings.ringEmissiveIntensity * THREE.MathUtils.lerp(0.35, 1, staging);
    for (const material of textMaterials) {
      material.opacity = 0.92 * textReveal * focus;
    }
  };

  scene.setScrollState = (state: SceneScrollState) => {
    setBaseScrollState(state);

    const timeline = getEarthTimeline(state);
    applyCameraTimeline(timeline);
    applyModelTimeline(timeline);
    applyStageTimeline(timeline);
  };

  return scene;
}
