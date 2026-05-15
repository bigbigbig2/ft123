import * as THREE from 'three';
import { ModelScene } from './ModelScene';
import type { SceneScrollState } from './SceneBase';
import { loadGLTF, loadTexture } from '../utils/loaders';

const EARTH_MODEL_ROOT = '/models/%E5%9C%B0%E7%90%83%E9%A1%B5%E9%9D%A2%E6%A8%A1%E5%9E%8B';
const EARTH_TEXTURE_ROOT = '/textures/earth';
const SCROLL_SPIN_START = 0.18;
const SCROLL_SPIN_END = 0.52;
const SCROLL_SPIN_TURNS = Math.PI * 2;

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

const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  uniform vec3 uColorDay;
  uniform vec3 uColorTwilight;
  uniform vec3 uSunDirection;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(vNormal);

    float fresnel = 1.0 - abs(dot(viewDirection, normal));
    float sunOrientation = dot(normal, normalize(uSunDirection));

    float colorMix = smoothstep(-0.25, 0.75, sunOrientation);
    vec3 atmosphereColor = mix(uColorTwilight, uColorDay, colorMix);

    float fresnelRemap = clamp((fresnel - 0.73) / (1.0 - 0.73), 0.0, 1.0);
    fresnelRemap = 1.0 - fresnelRemap;
    float alpha = pow(fresnelRemap, 3.0);
    alpha *= smoothstep(-0.5, 1.0, sunOrientation);

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(atmosphereColor, alpha);
  }
`;

const CLOUD_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUD_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;

  uniform sampler2D tCloudData;
  uniform vec3 uSunDirection;
  uniform float uCloudLow;
  uniform float uCloudHigh;
  uniform float uCloudOpacity;

  void main() {
    float clouds = texture2D(tCloudData, vUv).b;
    float alpha = smoothstep(uCloudLow, uCloudHigh, clouds) * uCloudOpacity;
    float light = smoothstep(-0.2, 0.85, dot(normalize(vNormal), normalize(uSunDirection)));
    vec3 color = mix(vec3(0.72, 0.86, 1.0), vec3(1.0), light);
    gl_FragColor = vec4(color, alpha);
  }
`;

function forEachMesh(root: THREE.Object3D, cb: (mesh: THREE.Mesh) => void) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    cb(mesh);
  });
}

function setMaterial(root: THREE.Object3D, material: THREE.Material) {
  forEachMesh(root, (mesh) => {
    const oldMaterial = mesh.material;
    mesh.material = material;
    if (Array.isArray(oldMaterial)) oldMaterial.forEach((mat) => mat.dispose());
    else oldMaterial?.dispose?.();
  });
}

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

function tuneTexture(texture: THREE.Texture, anisotropy = 8) {
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function moveBoxCenterTo(root: THREE.Object3D, target: THREE.Vector3) {
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.add(target.sub(center));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.min(1, Math.max(0, (value - edge0) / Math.max(edge1 - edge0, 0.0001)));
  return x * x * (3 - 2 * x);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

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

  globeMaterial.onBeforeCompile = (shader) => {
    globeMaterial.userData.shader = shader; // Save reference to update dynamically

    shader.uniforms.uAtmosphereDay = materialUniforms.uAtmosphereDay;
    shader.uniforms.uAtmosphereTwilight = materialUniforms.uAtmosphereTwilight;
    shader.uniforms.uSunDir = materialUniforms.uSunDir;
    shader.uniforms.uRoughnessLow = materialUniforms.uRoughnessLow;
    shader.uniforms.uRoughnessHigh = materialUniforms.uRoughnessHigh;
    shader.uniforms.uCloudLow = materialUniforms.uCloudLow;
    shader.uniforms.uCloudHigh = materialUniforms.uCloudHigh;
    shader.uniforms.uCloudOpacity = materialUniforms.uCloudOpacity;
    shader.uniforms.uCloudColor = materialUniforms.uCloudColor;
    shader.uniforms.tNight = materialUniforms.tNight;
    shader.uniforms.uNightIntensity = materialUniforms.uNightIntensity;
    shader.uniforms.uNightBlur = materialUniforms.uNightBlur;

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

      float sunOrientationDither = dot(normalDither, normalize(uSunDir));
      float colorMixDither = smoothstep(-0.25, 0.75, sunOrientationDither);
      vec3 atmosphereColorDither = mix(uAtmosphereTwilight, uAtmosphereDay, colorMixDither);

      float atmosphereDayStrengthDither = smoothstep(-0.5, 1.0, sunOrientationDither);
      float atmosphereMixDither = clamp(atmosphereDayStrengthDither * pow(fresnelDither, 2.0), 0.0, 1.0);

      // Night lights logic (9-Tap Gaussian Blur to eliminate aliasing and simulate true glow)
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

      // Atmosphere logic
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

  // Remove the default HemisphereLight as it flattens the procedural planet shading
  const hemiLight = scene.scene.children.find(c => c instanceof THREE.HemisphereLight);
  if (hemiLight) {
    scene.scene.remove(hemiLight);
  }

  const sun = new THREE.DirectionalLight('#ffffff', 1.0);
  sun.position.copy(earth.sunDirection).multiplyScalar(6);
  scene.scene.add(sun);

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

  scene.setScrollState = (state: SceneScrollState) => {
    setBaseScrollState(state);

    const preview = state.role === 'next'
      ? smoothstep(0, 1, state.enter) * 0.22
      : 0;
    const sceneProgress = state.role === 'current'
      ? 0.22 + smoothstep(0.02, 0.64, state.local) * 0.78
      : 0;
    const reveal = clamp01(Math.max(preview, sceneProgress));
    const pullBack = smoothstep(0.08, 0.76, reveal);
    const staging = smoothstep(0.52, 0.68, state.local);
    const textReveal = smoothstep(0.56, 0.72, state.local);
    const focus = clamp01(state.focus);
    const scrollSpin = smoothstep(SCROLL_SPIN_START, SCROLL_SPIN_END, state.local) * SCROLL_SPIN_TURNS;
    const spinComplete = state.role === 'current' && state.local >= SCROLL_SPIN_END;

    scene.camera.position.set(
      THREE.MathUtils.lerp(0.08, baseCameraPosition.x, pullBack),
      THREE.MathUtils.lerp(0.12, baseCameraPosition.y, pullBack),
      THREE.MathUtils.lerp(2.08, baseCameraPosition.z, pullBack),
    );
    scene.camera.fov = THREE.MathUtils.lerp(38, baseCameraFov, pullBack);
    scene.camera.updateProjectionMatrix();
    cameraLookAt.set(0, THREE.MathUtils.lerp(0.58, 0.02, pullBack), 0);
    scene.camera.lookAt(cameraLookAt);

    scene.modelRoot.position.y = baseModelY + THREE.MathUtils.lerp(
      -0.92,
      0,
      pullBack,
    );
    scene.modelRoot.scale.setScalar(
      baseModelScale * THREE.MathUtils.lerp(1.62, 1, pullBack),
    );
    scene.modelRoot.rotation.x = THREE.MathUtils.lerp(0.32, baseModelRotationX, pullBack);
    root.rotation.y = THREE.MathUtils.lerp(-0.22, 0.08, pullBack);
    earth.group.rotation.y = scrollSpin;
    scene.setAutoRotate(spinComplete);

    ring.scene.visible = staging > 0.001 && focus > 0.001;
    text.scene.visible = textReveal > 0.001 && focus > 0.001;
    ring.scene.position.y = baseRingPosition.y + THREE.MathUtils.lerp(-0.16, 0, staging);
    text.scene.position.y = baseTextPosition.y + THREE.MathUtils.lerp(-0.1, 0, textReveal);
    ring.scene.scale.setScalar(baseRingScale * THREE.MathUtils.lerp(0.9, 1, staging));
    text.scene.scale.setScalar(baseTextScale * THREE.MathUtils.lerp(0.96, 1, textReveal));

    ringMaterial.opacity = earthDebug.ringOpacity * staging * focus;
    ringMaterial.emissiveIntensity = earthDebug.ringEmissiveIntensity * THREE.MathUtils.lerp(0.35, 1, staging);
    for (const material of textMaterials) {
      material.opacity = 0.92 * textReveal * focus;
    }
  };

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
