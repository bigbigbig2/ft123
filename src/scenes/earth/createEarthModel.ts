import * as THREE from 'three';
import { loadTexture } from '../../utils/loaders';

const EARTH_TEXTURE_ROOT = '/textures/earth';

// 大气层单独用 ShaderMaterial 绘制，避免和地球标准材质的光照逻辑耦合。
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

export interface ProceduralEarthModel {
  group: THREE.Group;
  sunDirection: THREE.Vector3;
  globeMaterial: THREE.MeshStandardMaterial;
  atmosphereMaterial: THREE.ShaderMaterial;
}

/** 统一设置地球纹理采样质量。 */
function tuneTexture(texture: THREE.Texture, anisotropy = 8) {
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function createGlobeMaterial(
  dayTexture: THREE.Texture,
  bumpRoughnessCloudsTexture: THREE.Texture,
  nightTexture: THREE.Texture,
  sunDirection: THREE.Vector3,
) {
  // 以 MeshStandardMaterial 为基础，保留 Three.js 的 PBR 光照，再通过 onBeforeCompile 注入云层、夜灯和大气色。
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
    globeMaterial.userData.shader = shader;
    Object.assign(shader.uniforms, materialUniforms);

    // 给标准材质补充世界坐标和世界法线，片元阶段需要它们计算大气边缘和昼夜方向。
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      `,
    ).replace(
      '#include <worldpos_vertex>',
      `
      #include <worldpos_vertex>
      vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      `,
    );

    // 下面三段注入分别处理云层混合、粗糙度重映射、夜灯和大气色叠加。
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
      `,
    ).replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>
      #ifdef USE_ROUGHNESSMAP
        vec4 texelRoughnessForClouds = texture2D(roughnessMap, vRoughnessMapUv);
        float cloudsStrengthMap = smoothstep(uCloudLow, uCloudHigh, texelRoughnessForClouds.b) * uCloudOpacity;
        diffuseColor.rgb = mix(diffuseColor.rgb, uCloudColor, cloudsStrengthMap);
      #endif
      `,
    ).replace(
      '#include <roughnessmap_fragment>',
      `
      float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        vec4 texelRoughness = texture2D(roughnessMap, vRoughnessMapUv);
        float cloudsStrengthRoughness = smoothstep(uCloudLow, uCloudHigh, texelRoughness.b);
        float rawRoughness = max(texelRoughness.g, step(0.01, cloudsStrengthRoughness));
        roughnessFactor = mix(uRoughnessLow, uRoughnessHigh, rawRoughness);
      #endif
      `,
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
      gl_FragColor.rgb = mix(gl_FragColor.rgb, atmosphereColorDither, atmosphereMixDither);
      `,
    );
  };

  return { globeMaterial, materialUniforms };
}

/** 创建程序化地球本体。环和文字是外部 GLTF，仍由 EarthScene 装配。 */
export async function createProceduralEarth(): Promise<ProceduralEarthModel> {
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
  const { globeMaterial, materialUniforms } = createGlobeMaterial(
    dayTexture,
    bumpRoughnessCloudsTexture,
    nightTexture,
    sunDirection,
  );

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
    atmosphereMaterial,
  };
}
