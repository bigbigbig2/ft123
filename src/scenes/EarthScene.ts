import * as THREE from 'three';
import { ModelScene } from './ModelScene';
import type { SceneScrollState } from './SceneBase';
import { createProceduralEarth } from './earth/createEarthModel';
import { getEarthTimeline, type EarthTimeline } from './earth/earthTimeline';
import { moveBoxCenterTo, normalizeText, setMaterial } from './earth/earthSceneUtils';
import { loadGLTF } from '../utils/loaders';

const EARTH_MODEL_ROOT = '/models/%E5%9C%B0%E7%90%83%E9%A1%B5%E9%9D%A2%E6%A8%A1%E5%9E%8B';

/** 创建装饰环的材质：使用 PhysicalMaterial 模拟透明发光质感 */
function createRingMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: '#d8fbff',
    emissive: '#8ff8ff',
    emissiveIntensity: 0.26,
    transmission: 0.7, // 开启透光性
    thickness: 0.08,
    transparent: true,
    opacity: 0.14,
    roughness: 0.08,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false, // 关闭深度写入，防止半透明遮挡冲突
  });
}

/**
 * createEarthScene: 构建地球场景的核心方法。
 * 
 * 核心逻辑：
 * 1. 异步加载 3D 模型：地球（程序生成）、装饰环、文字。
 * 2. 场景布局：手动调整模型位置、缩放和光照。
 * 3. 动画驱动：通过拦截 setScrollState，将滚动进度解析为多维度的动画时间线 (EarthTimeline)。
 */
export async function createEarthScene() {
  const scene = new ModelScene({
    name: 'earth',
    fov: 31,
    cameraPosition: [0, 0.35, 4.25],
    cameraLookAt: [0, 0.02, 0],
    autoRotateSpeed: 0.045,
  });

  // 1. 并发加载所有资源
  const [earth, ring, text] = await Promise.all([
    createProceduralEarth(), // 程序化生成的地球（包含高级 Shader 材质）
    loadGLTF(`${EARTH_MODEL_ROOT}/huan.gltf`),
    loadGLTF(`${EARTH_MODEL_ROOT}/wenzi.gltf`),
  ]);

  // 2. 灯光调整：移除默认光照，添加根据地球太阳方向同步的平行光
  const hemiLight = scene.scene.children.find((child) => child instanceof THREE.HemisphereLight);
  if (hemiLight) scene.scene.remove(hemiLight);

  const sun = new THREE.DirectionalLight('#ffffff', 1.0);
  sun.position.copy(earth.sunDirection).multiplyScalar(6);
  scene.scene.add(sun);

  // 3. 材质与位置初始化
  const ringMaterial = createRingMaterial();
  setMaterial(ring.scene, ringMaterial);
  const textMaterials = normalizeText(text.scene); // 自动提取并标准化文字材质

  earth.group.scale.setScalar(1.2);
  ring.scene.scale.setScalar(0.92);
  text.scene.scale.setScalar(0.92);
  
  // 辅助工具：将模型中心对齐到指定位置
  moveBoxCenterTo(earth.group, new THREE.Vector3(0, 0.2, 0));
  moveBoxCenterTo(ring.scene, new THREE.Vector3(0, -0.1, 0));
  moveBoxCenterTo(text.scene, new THREE.Vector3(0, -0.09, 0));
  
  ring.scene.visible = false;
  text.scene.visible = false;

  // 4. 将所有部件组合到一个根节点下
  const root = new THREE.Group();
  root.name = 'earth-model-root';
  root.add(earth.group, ring.scene, text.scene);
  scene.attachAndFit(root, 3.0);

  // 记录初始状态，用于后续插值
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

  /** 相机时间线：处理拉远/靠近和视角平移 */
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

  /** 模型时间线：处理升起、缩放和自转切换 */
  const applyModelTimeline = ({ liftProgress, pullBack, scrollSpin, spinComplete }: EarthTimeline) => {
    scene.modelRoot.position.y = baseModelY + THREE.MathUtils.lerp(-1.6, 0, liftProgress);
    scene.modelRoot.scale.setScalar(baseModelScale * THREE.MathUtils.lerp(1.62, 1, pullBack));
    scene.modelRoot.rotation.x = THREE.MathUtils.lerp(0.32, baseModelRotationX, pullBack);
    root.rotation.y = THREE.MathUtils.lerp(-0.22, 0.08, pullBack);
    
    earth.group.rotation.y = scrollSpin;
    // 当滚动停止在特定区域时，开启自动旋转
    scene.setAutoRotate(spinComplete);
  };

  /** 舞台装饰时间线：处理圆环和文字的出现动画 */
  const applyStageTimeline = ({ staging, textReveal, focus }: EarthTimeline) => {
    // 根据进度决定显隐，减少不必要的 GPU 绘制
    ring.scene.visible = staging > 0.001 && focus > 0.001;
    text.scene.visible = textReveal > 0.001 && focus > 0.001;
    
    ring.scene.position.y = baseRingPosition.y + THREE.MathUtils.lerp(-0.16, 0, staging);
    text.scene.position.y = baseTextPosition.y + THREE.MathUtils.lerp(-0.1, 0, textReveal);
    ring.scene.scale.setScalar(baseRingScale * THREE.MathUtils.lerp(0.9, 1, staging));
    text.scene.scale.setScalar(baseTextScale * THREE.MathUtils.lerp(0.96, 1, textReveal));

    // 动态调整材质参数：结合 staging 和 focus（转场混合度）
    ringMaterial.opacity = earthSettings.ringOpacity * staging * focus;
    ringMaterial.emissiveIntensity = earthSettings.ringEmissiveIntensity * THREE.MathUtils.lerp(0.35, 1, staging);
    
    for (const material of textMaterials) {
      material.opacity = 0.92 * textReveal * focus;
    }
  };

  /** 
   * 拦截并重写场景的滚动状态处理逻辑 
   */
  scene.setScrollState = (state: SceneScrollState) => {
    setBaseScrollState(state); // 调用父类基础行为

    // 关键：将当前滚动状态映射为地球专属的时间线参数
    const timeline = getEarthTimeline(state);
    
    applyCameraTimeline(timeline);
    applyModelTimeline(timeline);
    applyStageTimeline(timeline);
  };

  return scene;
}
