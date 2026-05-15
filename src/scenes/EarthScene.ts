import * as THREE from 'three';
import { ModelScene } from './ModelScene';
import type { SceneScrollState } from './SceneBase';
import { loadGLTF, loadTexture } from '../utils/loaders';

/**
 * 地球场景配置文件及逻辑
 * 包含：
 * 1. 程序化地球材质（含大气层、云层、夜景灯光）
 * 2. 复杂的滚动时间轴动画（抬升、自转、拉远、环绕文字显示）
 */

// 模型与贴图资源路径
const EARTH_MODEL_ROOT = '/models/%E5%9C%B0%E7%90%83%E9%A1%B5%E9%9D%A2%E6%A8%A1%E5%9E%8B';
const EARTH_TEXTURE_ROOT = '/textures/earth';

// 动画控制常量
const SCROLL_SPIN_START = 0.15;    // 滚动进度达到 15% 时开始自转和拉远
const SCROLL_SPIN_END = 0.52;      // 滚动进度达到 52% 时自转和拉远完成
const SCROLL_SPIN_TURNS = Math.PI * 2; // 自转一整圈 (360度)

/**
 * 大气层顶点着色器
 * 计算顶点在世界空间的位置和法线，用于片元着色器的光照计算
 */
const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

/**
 * 大气层片元着色器
 * 实现基于菲涅尔效应 (Fresnel) 的外发光，并根据太阳方向切换昼夜颜色
 */
const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  uniform vec3 uColorDay;
  uniform vec3 uColorTwilight;
  uniform vec3 uSunDirection;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(vNormal);

    // 菲涅尔系数：视线与法线夹角越大，发光越强（边缘发光）
    float fresnel = 1.0 - abs(dot(viewDirection, normal));
    // 太阳方向权重
    float sunOrientation = dot(normal, normalize(uSunDirection));

    // 根据昼夜过渡大气层颜色
    float colorMix = smoothstep(-0.25, 0.75, sunOrientation);
    vec3 atmosphereColor = mix(uColorTwilight, uColorDay, colorMix);

    // 调整边缘 alpha 渐变，使其看起来更柔和
    float fresnelRemap = clamp((fresnel - 0.73) / (1.0 - 0.73), 0.0, 1.0);
    fresnelRemap = 1.0 - fresnelRemap;
    float alpha = pow(fresnelRemap, 3.0);
    alpha *= smoothstep(-0.5, 1.0, sunOrientation);

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(atmosphereColor, alpha);
  }
`;

/**
 * 辅助函数：遍历 Object3D 下的所有 Mesh 并执行回调
 */
function forEachMesh(root: THREE.Object3D, cb: (mesh: THREE.Mesh) => void) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false; // 禁用视锥裁剪防止大模型意外消失
    cb(mesh);
  });
}

/**
 * 辅助函数：批量替换材质并清理旧材质内存
 */
function setMaterial(root: THREE.Object3D, material: THREE.Material) {
  forEachMesh(root, (mesh) => {
    const oldMaterial = mesh.material;
    mesh.material = material;
    if (Array.isArray(oldMaterial)) oldMaterial.forEach((mat) => mat.dispose());
    else oldMaterial?.dispose?.();
  });
}

/**
 * 辅助函数：标准化文字材质，使其具备发光感和透明度
 */
function normalizeText(root: THREE.Object3D) {
  const materials: THREE.MeshBasicMaterial[] = [];

  forEachMesh(root, (mesh) => {
    const oldMaterial = mesh.material;
    const material = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    mesh.material = material;
    materials.push(material);

    if (Array.isArray(oldMaterial)) oldMaterial.forEach((mat) => mat.dispose());
    else oldMaterial?.dispose?.();
  });

  return materials;
}

/**
 * 辅助函数：调整纹理参数（各向异性过滤等）
 */
function tuneTexture(texture: THREE.Texture, anisotropy = 8) {
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 辅助函数：将模型的包围盒中心移动到指定世界坐标
 */
function moveBoxCenterTo(root: THREE.Object3D, target: THREE.Vector3) {
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.add(target.sub(center));
}

/**
 * GLSL 风格的平滑插值函数
 */
function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.min(1, Math.max(0, (value - edge0) / Math.max(edge1 - edge0, 0.0001)));
  return x * x * (3 - 2 * x);
}

/**
 * 将数值限制在 [0, 1] 范围内
 */
function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/**
 * 地球动画时间轴接口
 */
interface EarthTimeline {
  liftProgress: number; // 抬升进度 (从地平线升起)
  pullBack: number;     // 摄像机拉远进度
  staging: number;      // 环绕装饰展示进度
  textReveal: number;   // 标题文字展示进度
  focus: number;        // 场景聚焦程度
  scrollSpin: number;   // 滚轮控制的旋转角度
  spinComplete: boolean;// 滚轮自转是否完成
}

/**
 * 时间轴逻辑计算核心
 * 根据当前的滚动状态计算出所有动画元素的百分比进度
 */
function getEarthTimeline(state: SceneScrollState): EarthTimeline {
  const isCurrent = state.role === 'current';
  
  // 设定转场结束时地球预热抬升的比例
  const NEXT_LIFT_AMOUNT = 0.28;
  
  // 预热抬升：在 16% ~ 100% 转场期间，从 0 升到 0.28
  const nextLift = state.role === 'next'
    ? smoothstep(0.06, 1, state.enter) * NEXT_LIFT_AMOUNT
    : 0;
    
  // 正式抬升：进入场景后的前 15% 滚动距离完成剩下的抬升 (0.28 -> 1.0)
  const liftProgress = isCurrent
    ? NEXT_LIFT_AMOUNT + smoothstep(0, 1, clamp01(state.local / SCROLL_SPIN_START)) * (1 - NEXT_LIFT_AMOUNT)
    : nextLift;
    
  // 主拉远进度：从 15% 到 52% 滚动距离
  const pullBack = smoothstep(SCROLL_SPIN_START, SCROLL_SPIN_END, state.local);

  return {
    liftProgress,
    pullBack,
    staging: smoothstep(0.52, 0.68, state.local),
    textReveal: smoothstep(0.56, 0.72, state.local),
    focus: clamp01(state.focus),
    scrollSpin: smoothstep(SCROLL_SPIN_START, SCROLL_SPIN_END, state.local) * SCROLL_SPIN_TURNS,
    spinComplete: isCurrent && state.local >= SCROLL_SPIN_END,
  };
}

/**
 * 创建程序化地球（包含复杂材质逻辑）
 */
async function createProceduralEarth() {
  const [dayTexture, bumpRoughnessCloudsTexture, nightTexture] = await Promise.all([
    loadTexture(`${EARTH_TEXTURE_ROOT}/earth_day_4096.jpg`, {
      colorSpace: THREE.SRGBColorSpace,
    }),
    loadTexture(`${EARTH_TEXTURE_ROOT}/earth_bump_roughness_clouds_4096.jpg`),
    loadTexture(`${EARTH_TEXTURE_ROOT}/earth_night_4096.jpg`, {
      colorSpace: THREE.SRGBColorSpace,
    }),
  ]);

  tuneTexture(dayTexture);
  tuneTexture(bumpRoughnessCloudsTexture);
  tuneTexture(nightTexture);

  const sunDirection = new THREE.Vector3(0.25, 0.16, 0.36).normalize();
  const sphereGeometry = new THREE.SphereGeometry(1, 96, 96);

  // 基础材质：基于标准材质，稍后注入 Shader 代码实现云层和夜灯
  const globeMaterial = new THREE.MeshStandardMaterial({
    map: dayTexture,
    bumpMap: bumpRoughnessCloudsTexture,
    bumpScale: 0.015,
    roughnessMap: bumpRoughnessCloudsTexture,
    metalness: 0,
  });

  const materialUniforms = {
    uAtmosphereDay: { value: new THREE.Color('#4db2ff') },
    uAtmosphereTwilight: { value: new THREE.Color('#ffffff') },
    uSunDir: { value: sunDirection },
    uRoughnessLow: { value: 0.8 },
    uRoughnessHigh: { value: 1.0 },
    uCloudLow: { value: 0.07 },
    uCloudHigh: { value: 0.92 },
    uCloudOpacity: { value: 0.7 },
    uCloudColor: { value: new THREE.Color('#ffffff') },
    tNight: { value: nightTexture },
    uNightIntensity: { value: 4.0 },
    uNightBlur: { value: 2.0 },
  };

  // 注入自定义 GLSL 代码以实现原生材质无法完成的效果
  globeMaterial.onBeforeCompile = (shader) => {
    globeMaterial.userData.shader = shader; // 保存引用用于 GUI 调试

    Object.assign(shader.uniforms, materialUniforms);

    // 顶点着色器注入：传递世界空间坐标和法线
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      `
    ).replace(
      '#include <worldpos_vertex>',
      `
      #include <worldpos_vertex>
      vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      `
    );

    // 片元着色器注入：云层混合、动态粗糙度、带模糊的夜景灯光、大气散射
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      uniform vec3 uAtmosphereDay;
      uniform vec3 uAtmosphereTwilight;
      uniform vec3 uSunDir;
      uniform float uRoughnessLow;
      uniform float uRoughnessHigh;
      uniform float uCloudLow;
      uniform float uCloudHigh;
      uniform float uCloudOpacity;
      uniform vec3 uCloudColor;
      uniform sampler2D tNight;
      uniform float uNightIntensity;
      uniform float uNightBlur;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      `
    ).replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>
      #ifdef USE_ROUGHNESSMAP
        vec4 texelRoughnessForClouds = texture2D( roughnessMap, vRoughnessMapUv );
        // 在漫反射颜色上混合云层
        float cloudsStrengthMap = smoothstep(uCloudLow, uCloudHigh, texelRoughnessForClouds.b) * uCloudOpacity;
        diffuseColor.rgb = mix(diffuseColor.rgb, uCloudColor, cloudsStrengthMap);
      #endif
      `
    ).replace(
      '#include <roughnessmap_fragment>',
      `
      float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
        float cloudsStrengthRoughness = smoothstep(uCloudLow, uCloudHigh, texelRoughness.b);
        // 云层和陆地的粗糙度区别对待
        float rawRoughness = max(texelRoughness.g, step(0.01, cloudsStrengthRoughness));
        roughnessFactor = mix(uRoughnessLow, uRoughnessHigh, rawRoughness);
      #endif
      `
    ).replace(
      '#include <dithering_fragment>',
      `
      #include <dithering_fragment>

      vec3 viewDirDither = normalize(cameraPosition - vWorldPosition);
      vec3 normalDither = normalize(vWorldNormal);
      float fresnelDither = 1.0 - abs(dot(viewDirDither, normalDither));

      // 大气颜色逻辑
      float sunOrientationDither = dot(normalDither, normalize(uSunDir));
      float colorMixDither = smoothstep(-0.25, 0.75, sunOrientationDither);
      vec3 atmosphereColorDither = mix(uAtmosphereTwilight, uAtmosphereDay, colorMixDither);
      float atmosphereDayStrengthDither = smoothstep(-0.5, 1.0, sunOrientationDither);
      float atmosphereMixDither = clamp(atmosphereDayStrengthDither * pow(fresnelDither, 2.0), 0.0, 1.0);

      // 夜灯逻辑 (使用 9-Tap 高斯模糊消除锯齿并模拟光晕感)
      float o = uNightBlur * 0.0003;
      vec3 nightColorDither = texture2D(tNight, vRoughnessMapUv).rgb * 0.25;
      nightColorDither += texture2D(tNight, vRoughnessMapUv + vec2(o, 0.0)).rgb * 0.125;
      nightColorDither += texture2D(tNight, vRoughnessMapUv + vec2(-o, 0.0)).rgb * 0.125;
      nightColorDither += texture2D(tNight, vRoughnessMapUv + vec2(0.0, o)).rgb * 0.125;
      nightColorDither += texture2D(tNight, vRoughnessMapUv + vec2(0.0, -o)).rgb * 0.125;
      nightColorDither += texture2D(tNight, vRoughnessMapUv + vec2(o, o)).rgb * 0.0625;
      nightColorDither += texture2D(tNight, vRoughnessMapUv + vec2(-o, o)).rgb * 0.0625;
      nightColorDither += texture2D(tNight, vRoughnessMapUv + vec2(o, -o)).rgb * 0.0625;
      nightColorDither += texture2D(tNight, vRoughnessMapUv + vec2(-o, -o)).rgb * 0.0625;
      
      nightColorDither *= uNightIntensity;
      gl_FragColor.rgb += nightColorDither;

      // 混合最终大气颜色
      gl_FragColor.rgb = mix(gl_FragColor.rgb, atmosphereColorDither, atmosphereMixDither);
      `
    );
  };

  const globe = new THREE.Mesh(sphereGeometry, globeMaterial);
  globe.name = 'procedural-earth-globe';

  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColorDay: materialUniforms.uAtmosphereDay,
      uColorTwilight: materialUniforms.uAtmosphereTwilight,
      uSunDirection: materialUniforms.uSunDir,
    },
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    transparent: true,
    side: THREE.BackSide,
  });

  const atmosphere = new THREE.Mesh(sphereGeometry, atmosphereMaterial);
  atmosphere.name = 'procedural-earth-atmosphere';
  atmosphere.scale.setScalar(1.04);

  const group = new THREE.Group();
  group.name = 'procedural-earth';
  group.add(globe, atmosphere);

  return {
    group,
    sunDirection,
    globeMaterial,
    atmosphereMaterial: atmosphere.material as THREE.ShaderMaterial,
  };
}

/**
 * 主函数：初始化地球场景
 */
export async function createEarthScene() {
  const scene = new ModelScene({
    name: 'earth',
    fov: 31,
    cameraPosition: [0, 0.35, 4.25],
    cameraLookAt: [0, 0.02, 0],
    autoRotateSpeed: 0.045,
  });

  // 加载地球、环、文字模型
  const [earth, ring, text] = await Promise.all([
    createProceduralEarth(),
    loadGLTF(`${EARTH_MODEL_ROOT}/huan.gltf`),
    loadGLTF(`${EARTH_MODEL_ROOT}/wenzi.gltf`),
  ]);

  // 移除默认半球光，避免冲淡程序化星球的阴影效果
  const hemiLight = scene.scene.children.find(c => c instanceof THREE.HemisphereLight);
  if (hemiLight) {
    scene.scene.remove(hemiLight);
  }

  // 添加太阳光（平行光）
  const sun = new THREE.DirectionalLight('#ffffff', 1.0);
  sun.position.copy(earth.sunDirection).multiplyScalar(6);
  scene.scene.add(sun);

  // 装饰环材质
  const ringMaterial = new THREE.MeshPhysicalMaterial({
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

  setMaterial(ring.scene, ringMaterial);
  const textMaterials = normalizeText(text.scene);

  // 初始化模型变换
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

  // 记录基础变换值用于后续 lerp
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

  /**
   * 动画更新：摄像机部分
   */
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

  /**
   * 动画更新：地球主体部分
   */
  const applyModelTimeline = ({ liftProgress, pullBack, scrollSpin, spinComplete }: EarthTimeline) => {
    // Y 轴抬升 (地平线升起效果)
    scene.modelRoot.position.y = baseModelY + THREE.MathUtils.lerp(
      -1.6,
      0,
      liftProgress,
    );
    // 缩放与 X 轴俯仰
    scene.modelRoot.scale.setScalar(
      baseModelScale * THREE.MathUtils.lerp(1.62, 1, pullBack),
    );
    scene.modelRoot.rotation.x = THREE.MathUtils.lerp(0.32, baseModelRotationX, pullBack);
    // Y 轴整体偏转
    root.rotation.y = THREE.MathUtils.lerp(-0.22, 0.08, pullBack);
    // 滚轮控制的自转角度
    earth.group.rotation.y = scrollSpin;
    // 自转接管状态
    scene.setAutoRotate(spinComplete);
  };

  /**
   * 动画更新：辅助舞台元素 (环、文字)
   */
  const applyStageTimeline = ({ staging, textReveal, focus }: EarthTimeline) => {
    ring.scene.visible = staging > 0.001 && focus > 0.001;
    text.scene.visible = textReveal > 0.001 && focus > 0.001;
    ring.scene.position.y = baseRingPosition.y + THREE.MathUtils.lerp(-0.16, 0, staging);
    text.scene.position.y = baseTextPosition.y + THREE.MathUtils.lerp(-0.1, 0, textReveal);
    ring.scene.scale.setScalar(baseRingScale * THREE.MathUtils.lerp(0.9, 1, staging));
    text.scene.scale.setScalar(baseTextScale * THREE.MathUtils.lerp(0.96, 1, textReveal));

    // 材质属性更新
    ringMaterial.opacity = earthDebug.ringOpacity * staging * focus;
    ringMaterial.emissiveIntensity = earthDebug.ringEmissiveIntensity * THREE.MathUtils.lerp(0.35, 1, staging);
    for (const material of textMaterials) {
      material.opacity = 0.92 * textReveal * focus;
    }
  };

  /**
   * 核心滚动状态钩子
   * 每一帧滚动更新时调用
   */
  scene.setScrollState = (state: SceneScrollState) => {
    setBaseScrollState(state);

    const timeline = getEarthTimeline(state);
    applyCameraTimeline(timeline);
    applyModelTimeline(timeline);
    applyStageTimeline(timeline);
  };

  // 调试面板配置对象
  const earthDebug = {
    bumpScale: 0.015,
    roughnessLow: 0.8,
    roughnessHigh: 1.0,
    cloudLow: 0.07,
    cloudHigh: 0.92,
    cloudOpacity: 0.7,
    cloudColor: '#ffffff',
    nightIntensity: 4.0,
    nightBlur: 2.0,
    atmosphereDayColor: '#4db2ff',
    atmosphereTwilightColor: '#ffffff',
    ringOpacity: 0.14,
    ringEmissiveIntensity: 0.26,
    sunIntensity: 1.0,
    sunX: 0.25,
    sunY: 0.16,
    sunZ: 0.36,
  };

  // 将调试逻辑挂载到场景对象上，供外部 GUI 访问
  (scene as unknown as {
    debugControls: {
      earth: typeof earthDebug;
      applyEarthDebug: () => void;
    };
  }).debugControls = {
    earth: earthDebug,
    applyEarthDebug: () => {
      earth.globeMaterial.bumpScale = earthDebug.bumpScale;

      const shader = earth.globeMaterial.userData.shader;
      if (shader) {
        shader.uniforms.uRoughnessLow.value = earthDebug.roughnessLow;
        shader.uniforms.uRoughnessHigh.value = earthDebug.roughnessHigh;
        shader.uniforms.uCloudLow.value = earthDebug.cloudLow;
        shader.uniforms.uCloudHigh.value = earthDebug.cloudHigh;
        shader.uniforms.uCloudOpacity.value = earthDebug.cloudOpacity;
        shader.uniforms.uCloudColor.value.set(earthDebug.cloudColor);
        shader.uniforms.uNightIntensity.value = earthDebug.nightIntensity;
        shader.uniforms.uNightBlur.value = earthDebug.nightBlur;
        shader.uniforms.uAtmosphereDay.value.set(earthDebug.atmosphereDayColor);
        shader.uniforms.uAtmosphereTwilight.value.set(earthDebug.atmosphereTwilightColor);
      }

      if (earth.atmosphereMaterial.uniforms.uColorDay) {
        earth.atmosphereMaterial.uniforms.uColorDay.value.set(earthDebug.atmosphereDayColor);
        earth.atmosphereMaterial.uniforms.uColorTwilight.value.set(earthDebug.atmosphereTwilightColor);
      }

      ringMaterial.opacity = earthDebug.ringOpacity;
      ringMaterial.emissiveIntensity = earthDebug.ringEmissiveIntensity;

      sun.intensity = earthDebug.sunIntensity;
      earth.sunDirection.set(earthDebug.sunX, earthDebug.sunY, earthDebug.sunZ).normalize();
      sun.position.copy(earth.sunDirection).multiplyScalar(6);
    },
  };

  return scene;
}
