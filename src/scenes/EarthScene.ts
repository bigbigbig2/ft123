import * as THREE from 'three';
import { ModelScene } from './ModelScene';
import { loadGLTF, loadTexture } from '../utils/loaders';

const EARTH_MODEL_ROOT = '/models/%E5%9C%B0%E7%90%83%E9%A1%B5%E9%9D%A2%E6%A8%A1%E5%9E%8B';
const EARTH_TEXTURE_ROOT = '/textures/earth';

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
  forEachMesh(root, (mesh) => {
    const oldMaterial = mesh.material;
    mesh.material = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    if (Array.isArray(oldMaterial)) oldMaterial.forEach((mat) => mat.dispose());
    else oldMaterial?.dispose?.();
  });
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

async function createProceduralEarth() {
  const [dayTexture, bumpRoughnessCloudsTexture] = await Promise.all([
    loadTexture(`${EARTH_TEXTURE_ROOT}/earth_day_4096.jpg`, {
      colorSpace: THREE.SRGBColorSpace,
    }),

    loadTexture(`${EARTH_TEXTURE_ROOT}/earth_bump_roughness_clouds_4096.jpg`),
  ]);

  tuneTexture(dayTexture);
  tuneTexture(bumpRoughnessCloudsTexture);

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
    uAtmosphereTwilight: { value: new THREE.Color('#bc490b') },
    uSunDir: { value: sunDirection },
    uRoughnessLow: { value: 0.8 },
    uRoughnessHigh: { value: 1.0 },
    uCloudLow: { value: 0.07 },
    uCloudHigh: { value: 0.92 },
    uCloudOpacity: { value: 0.9 },
    uCloudColor: { value: new THREE.Color('#ffffff') },
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

  const sun = new THREE.DirectionalLight('#ffffff', 3.05);
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
  normalizeText(text.scene);

  earth.group.scale.setScalar(1.2);
  ring.scene.scale.setScalar(0.92);
  text.scene.scale.setScalar(0.92);
  moveBoxCenterTo(earth.group, new THREE.Vector3(0, 0.2, 0));
  moveBoxCenterTo(ring.scene, new THREE.Vector3(0, -0.1, 0));
  moveBoxCenterTo(text.scene, new THREE.Vector3(0, -0.09, 0));

  const root = new THREE.Group();
  root.name = 'earth-model-root';
  root.add(earth.group, ring.scene, text.scene);

  scene.attachAndFit(root, 3.0);
  const baseScalePerUnit = root.scale.x / 3.0;
  const basePositionPerUnit = root.position.clone().divideScalar(3.0);

  scene.modelRoot.position.y = -0.07;
  scene.modelRoot.rotation.x = 0.2;
  scene.modelRoot.rotation.y = 3.0;

  const earthDebug = {
    bumpScale: 0.015,
    roughnessLow: 0.8,
    roughnessHigh: 1.0,
    cloudLow: 0.07,
    cloudHigh: 0.92,
    cloudOpacity: 0.9,
    cloudColor: '#ffffff',
    atmosphereDayColor: '#4db2ff',
    atmosphereTwilightColor: '#bc490b',
    ringOpacity: 0.14,
    ringEmissiveIntensity: 0.26,
    sunIntensity: 3.05,
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
