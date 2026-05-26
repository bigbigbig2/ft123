import * as THREE from 'three';
import { loadTexture } from '../../utils/loaders';

const EARTH_TEXTURE_ROOT = '/textures/earth';
const EARTH_MODEL_TEXTURE_ROOT = '/models/%E5%9C%B0%E7%90%83%E9%A1%B5%E9%9D%A2%E6%A8%A1%E5%9E%8B/%E5%9C%B0%E7%90%83%E8%B4%B4%E5%9B%BE';

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
  uniform float uStrength;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(vNormal);
    float fresnel = 1.0 - abs(dot(viewDirection, normal));
    vec3 atmosphereColor = mix(uColorTwilight, uColorDay, 0.65);
    float fresnelRemap = clamp((fresnel - 0.73) / (1.0 - 0.73), 0.0, 1.0);
    fresnelRemap = 1.0 - fresnelRemap;
    float alpha = pow(fresnelRemap, 3.0) * uStrength;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(atmosphereColor, alpha);
  }
`;

export interface ProceduralEarthModel {
  group: THREE.Group;
  sunDirection: THREE.Vector3;
  globeMaterial: THREE.MeshStandardMaterial;
  cloudMaterial: THREE.MeshStandardMaterial;
  atmosphereMaterial: THREE.ShaderMaterial;
  materialUniforms: {
    uAtmosphereDay: { value: THREE.Color };
    uAtmosphereTwilight: { value: THREE.Color };
    uAtmosphereStrength: { value: number };
    uSunDir: { value: THREE.Vector3 };
    tSurfaceControl: { value: THREE.Texture };
    tClouds: { value: THREE.Texture };
    uDayBrightness: { value: number };
    uDaySaturation: { value: number };
    uOceanLift: { value: number };
    uOceanCyanShift: { value: number };
    uLandLift: { value: number };
    uLandDeYellow: { value: number };
    uVegetationBoost: { value: number };
    uHazeStrength: { value: number };
    uOceanRoughness: { value: number };
    uLandRoughness: { value: number };
    uCloudRoughness: { value: number };
    uCloudLow: { value: number };
    uCloudHigh: { value: number };
    uCloudOpacity: { value: number };
    uCloudBrightness: { value: number };
    uCloudColor: { value: THREE.Color };
    uCloudTime: { value: number };
    uCloudMotionEnabled: { value: number };
    uCloudFlowSpeed: { value: number };
    uCloudWarpStrength: { value: number };
    uCloudDetailStrength: { value: number };
    uCloudEdgeMotion: { value: number };
    tNight: { value: THREE.Texture };
    uNightIntensity: { value: number };
    uNightFadeStart: { value: number };
    uNightFadeEnd: { value: number };
    uOceanSpecStrength: { value: number };
    uOceanFresnelStrength: { value: number };
  };
}

function tuneTexture(texture: THREE.Texture, anisotropy = 8) {
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function createCloudMaterial(
  cloudTexture: THREE.Texture,
  materialUniforms: ProceduralEarthModel['materialUniforms'],
) {
  const cloudMaterial = new THREE.MeshStandardMaterial({
    map: cloudTexture,
    transparent: true,
    depthWrite: false,
    roughness: materialUniforms.uCloudRoughness.value,
    metalness: 0,
    color: materialUniforms.uCloudColor.value.clone(),
  });

  cloudMaterial.onBeforeCompile = (shader) => {
    cloudMaterial.userData.shader = shader;
    Object.assign(shader.uniforms, {
      uCloudLow: materialUniforms.uCloudLow,
      uCloudHigh: materialUniforms.uCloudHigh,
      uCloudOpacity: materialUniforms.uCloudOpacity,
      uCloudBrightness: materialUniforms.uCloudBrightness,
      uCloudColor: materialUniforms.uCloudColor,
      uCloudTime: materialUniforms.uCloudTime,
      uCloudMotionEnabled: materialUniforms.uCloudMotionEnabled,
      uCloudFlowSpeed: materialUniforms.uCloudFlowSpeed,
      uCloudWarpStrength: materialUniforms.uCloudWarpStrength,
      uCloudDetailStrength: materialUniforms.uCloudDetailStrength,
      uCloudEdgeMotion: materialUniforms.uCloudEdgeMotion,
    });

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      uniform float uCloudLow;
      uniform float uCloudHigh;
      uniform float uCloudOpacity;
      uniform float uCloudBrightness;
      uniform vec3 uCloudColor;

      uniform float uCloudTime;
      uniform float uCloudMotionEnabled;
      uniform float uCloudFlowSpeed;
      uniform float uCloudWarpStrength;
      uniform float uCloudDetailStrength;
      uniform float uCloudEdgeMotion;

      vec2 cloudSampleUv(vec2 uv) {
        return vec2(fract(uv.x), clamp(uv.y, 0.001, 0.999));
      }
      `,
    ).replace(
      '#include <map_fragment>',
      `
      #ifdef USE_MAP
        vec4 sampledCloud = texture2D(map, vMapUv);
        float motion = step(0.5, uCloudMotionEnabled);
        float flowTime = uCloudTime * uCloudFlowSpeed * motion;
        float warp = uCloudWarpStrength * motion;

        vec2 flowUvA = cloudSampleUv(vec2(
          vMapUv.x + flowTime * 0.35 + sin(vMapUv.y * 18.0 + flowTime * 5.0) * warp * 0.42,
          vMapUv.y + cos(vMapUv.x * 13.0 - flowTime * 4.0) * warp * 0.18
        ));
        vec2 flowUvB = cloudSampleUv(vec2(
          vMapUv.x - flowTime * 0.22 + sampledCloud.r * warp * 0.48,
          vMapUv.y + flowTime * 0.035 + sin((vMapUv.x + vMapUv.y) * 16.0 + flowTime * 6.0) * warp * 0.24
        ));

        float cloudFlowA = texture2D(map, flowUvA).r;
        float cloudFlowB = texture2D(map, flowUvB).r;
        float movingDetail = mix(cloudFlowA, cloudFlowB, 0.45);
        float edgeDetail = abs(cloudFlowA - cloudFlowB);
        float animatedCloud = mix(sampledCloud.r, movingDetail, uCloudDetailStrength * motion);
        float animatedLow = uCloudLow + (movingDetail - 0.5) * uCloudEdgeMotion * 0.18 * motion;
        float cloudMask = smoothstep(animatedLow, uCloudHigh, animatedCloud + edgeDetail * uCloudEdgeMotion * motion);

        diffuseColor.rgb = mix(uCloudColor * 0.72, uCloudColor * uCloudBrightness, animatedCloud);
        diffuseColor.a = cloudMask * uCloudOpacity;
      #endif
      `,
    );
  };

  return cloudMaterial;
}

function createGlobeMaterial(
  dayTexture: THREE.Texture,
  surfaceControlTexture: THREE.Texture,
  displacementTexture: THREE.Texture,
  normalTexture: THREE.Texture,
  cloudTexture: THREE.Texture,
  nightTexture: THREE.Texture,
  sunDirection: THREE.Vector3,
) {
  const globeMaterial = new THREE.MeshStandardMaterial({
    map: dayTexture,
    bumpMap: displacementTexture,
    bumpScale: 0.06,
    normalMap: normalTexture,
    normalScale: new THREE.Vector2(2.01, 2.01),
    roughness: 1,
    metalness: 0,
  });

  const materialUniforms = {
    uAtmosphereDay: { value: new THREE.Color('#90a8c8') },
    uAtmosphereTwilight: { value: new THREE.Color('#ffffff') },
    uAtmosphereStrength: { value: 0.85 },
    uSunDir: { value: sunDirection },
    tSurfaceControl: { value: surfaceControlTexture },
    tClouds: { value: cloudTexture },
    uDayBrightness: { value: 1.12 },
    uDaySaturation: { value: 0.82 },
    uOceanLift: { value: 0.52 },
    uOceanCyanShift: { value: 0.36 },
    uLandLift: { value: 0.74 },
    uLandDeYellow: { value: 0.58 },
    uVegetationBoost: { value: 0.52 },
    uHazeStrength: { value: 0.72 },
    uOceanRoughness: { value: 0.739 },
    uLandRoughness: { value: 0.9 },
    uCloudRoughness: { value: 0.96 },
    uCloudLow: { value: 0.043 },
    uCloudHigh: { value: 0.62 },
    uCloudOpacity: { value: 0.799 },
    uCloudBrightness: { value: 1.33 },
    uCloudColor: { value: new THREE.Color('#ebebeb') },
    uCloudTime: { value: 0 },
    uCloudMotionEnabled: { value: 1 },
    uCloudFlowSpeed: { value: 0.018 },
    uCloudWarpStrength: { value: 0.018 },
    uCloudDetailStrength: { value: 0.28 },
    uCloudEdgeMotion: { value: 0.12 },
    tNight: { value: nightTexture },
    uNightIntensity: { value: 3.91 },
    uNightFadeStart: { value: 0.0 },
    uNightFadeEnd: { value: 0.5 },
    uOceanSpecStrength: { value: 0.0 },
    uOceanFresnelStrength: { value: 0.0 },
  };

  globeMaterial.onBeforeCompile = (shader) => {
    globeMaterial.userData.shader = shader;
    Object.assign(shader.uniforms, materialUniforms);

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

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      uniform vec3 uAtmosphereDay;
      uniform vec3 uAtmosphereTwilight;
      uniform float uAtmosphereStrength;
      uniform vec3 uSunDir;
      uniform sampler2D tSurfaceControl;
      uniform sampler2D tClouds;
      uniform float uDayBrightness;
      uniform float uDaySaturation;
      uniform float uOceanLift;
      uniform float uOceanCyanShift;
      uniform float uLandLift;
      uniform float uLandDeYellow;
      uniform float uVegetationBoost;
      uniform float uHazeStrength;
      uniform float uOceanRoughness;
      uniform float uLandRoughness;
      uniform float uCloudRoughness;
      uniform float uCloudLow;
      uniform float uCloudHigh;
      uniform float uCloudOpacity;
      uniform vec3 uCloudColor;
      uniform sampler2D tNight;
      uniform float uNightIntensity;
      uniform float uNightFadeStart;
      uniform float uNightFadeEnd;
      uniform float uOceanSpecStrength;
      uniform float uOceanFresnelStrength;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      `,
    ).replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>
      vec4 surfaceControlMapTexel = texture2D(tSurfaceControl, vMapUv);
      float landMaskMap = smoothstep(0.06, 0.32, surfaceControlMapTexel.g - surfaceControlMapTexel.b);
      vec3 baseDayColor = diffuseColor.rgb;
      float baseDayLuma = dot(baseDayColor, vec3(0.2126, 0.7152, 0.0722));
      baseDayColor = mix(vec3(baseDayLuma), baseDayColor, uDaySaturation) * uDayBrightness;

      float vegetationSignal = max(baseDayColor.g - max(baseDayColor.r * 0.92, baseDayColor.b * 1.03), 0.0);
      float vegetationMask = landMaskMap * smoothstep(0.015, 0.16, vegetationSignal);
      float aridSignal = max(baseDayColor.r + baseDayColor.g * 0.72 - baseDayColor.b * 1.25, 0.0);
      float aridMask = landMaskMap * smoothstep(0.12, 0.5, aridSignal) * (1.0 - vegetationMask * 0.85);

      vec3 deYellowLandColor = clamp(baseDayColor * vec3(0.94, 1.01, 1.07) + vec3(-0.01, 0.01, 0.03), 0.0, 1.0);
      vec3 greenerLandColor = clamp(baseDayColor * vec3(0.92, 1.16, 0.90) + vec3(0.00, 0.05, 0.00), 0.0, 1.0);
      vec3 tunedLandBase = mix(baseDayColor, deYellowLandColor, aridMask * uLandDeYellow);
      tunedLandBase = mix(tunedLandBase, greenerLandColor, vegetationMask * uVegetationBoost);

      vec3 oceanCyanColor = clamp(baseDayColor * vec3(0.84, 1.06, 1.08) + vec3(0.00, 0.08, 0.08), 0.0, 1.0);
      vec3 liftedOceanColor = mix(
        min(baseDayColor * vec3(0.92, 1.04, 1.18) + vec3(0.00, 0.05, 0.14), vec3(1.0)),
        oceanCyanColor,
        uOceanCyanShift
      );
      vec3 liftedLandColor = min(tunedLandBase * vec3(1.03, 1.02, 0.98) + vec3(0.03, 0.03, 0.02), vec3(1.0));
      vec3 oceanDayColor = mix(baseDayColor, liftedOceanColor, uOceanLift);
      vec3 landDayColor = mix(tunedLandBase, liftedLandColor, uLandLift);
      diffuseColor.rgb = mix(oceanDayColor, landDayColor, landMaskMap);
      `,
    ).replace(
      '#include <roughnessmap_fragment>',
      `
      float roughnessFactor = roughness;
      vec4 surfaceControlRoughnessTexel = texture2D(tSurfaceControl, vMapUv);
      float landMaskRoughness = smoothstep(0.06, 0.32, surfaceControlRoughnessTexel.g - surfaceControlRoughnessTexel.b);
      float terrainDetailRoughness = surfaceControlRoughnessTexel.r;
      float baseRoughness = mix(uOceanRoughness, uLandRoughness, landMaskRoughness);
      baseRoughness = mix(baseRoughness, min(1.0, baseRoughness + 0.08), terrainDetailRoughness * landMaskRoughness * 0.35);
      roughnessFactor = baseRoughness;
      `,
    ).replace(
      '#include <dithering_fragment>',
      `
      #include <dithering_fragment>

      vec3 viewDirDither = normalize(cameraPosition - vWorldPosition);
      vec3 normalDither = normalize(vWorldNormal);
      float fresnelDither = 1.0 - abs(dot(viewDirDither, normalDither));

      float sunOrientationDither = dot(normalDither, normalize(uSunDir));
      vec3 atmosphereColorDither = mix(uAtmosphereTwilight, uAtmosphereDay, 0.65);
      float atmosphereMixDither = clamp(pow(fresnelDither, 2.0) * uAtmosphereStrength, 0.0, 1.0);

      vec4 surfaceControlDitherTexel = texture2D(tSurfaceControl, vMapUv);
      float landMaskDither = smoothstep(0.06, 0.32, surfaceControlDitherTexel.g - surfaceControlDitherTexel.b);
      float oceanMaskDither = 1.0 - landMaskDither;
      float cloudMaskDither = smoothstep(uCloudLow, uCloudHigh, texture2D(tClouds, vMapUv).r);
      float nightMask = 1.0 - smoothstep(uNightFadeEnd, uNightFadeStart, sunOrientationDither);

      vec3 nightColorSample = texture2D(tNight, vMapUv).rgb;
      nightColorSample = pow(nightColorSample, vec3(0.72));
      vec3 nightColorDither = nightColorSample * vec3(1.12, 0.82, 0.58) * uNightIntensity * nightMask * landMaskDither * (1.0 - cloudMaskDither * 0.22);
      gl_FragColor.rgb += nightColorDither;

      vec3 sunHalfVector = normalize(normalize(uSunDir) + viewDirDither);
      float oceanSpecular = pow(max(dot(normalDither, sunHalfVector), 0.0), 48.0);
      float oceanFresnel = pow(1.0 - max(dot(viewDirDither, normalDither), 0.0), 3.0);
      float oceanSpark = oceanMaskDither * smoothstep(-0.05, 0.4, sunOrientationDither) * (1.0 - cloudMaskDither * 0.75);
      gl_FragColor.rgb += vec3(0.08, 0.12, 0.18) * oceanSpecular * oceanSpark * uOceanSpecStrength;
      gl_FragColor.rgb += vec3(0.03, 0.06, 0.10) * oceanFresnel * oceanSpark * uOceanFresnelStrength;

      float frontHaze = pow(1.0 - max(dot(viewDirDither, normalDither), 0.0), 1.8);
      float dayHaze = smoothstep(-0.1, 0.75, sunOrientationDither) * (0.15 + frontHaze * 0.85) * uHazeStrength;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.76, 0.86, 0.96), dayHaze);

      gl_FragColor.rgb = mix(gl_FragColor.rgb, atmosphereColorDither, atmosphereMixDither);
      `,
    );
  };

  return { globeMaterial, materialUniforms };
}

export async function createProceduralEarth(): Promise<ProceduralEarthModel> {
  const [dayTexture, surfaceControlTexture, displacementTexture, normalTexture, cloudTexture, nightTexture] = await Promise.all([
    loadTexture(`${EARTH_TEXTURE_ROOT}/earth_day_4096.jpg`, {
      colorSpace: THREE.SRGBColorSpace,
    }),
    loadTexture(`${EARTH_TEXTURE_ROOT}/earth_bump_roughness_clouds_4096.jpg`),
    loadTexture(`${EARTH_MODEL_TEXTURE_ROOT}/earth_displace.jpg`),
    loadTexture(`${EARTH_MODEL_TEXTURE_ROOT}/earth_displace_NORM-4k.png`),
    loadTexture(`${EARTH_MODEL_TEXTURE_ROOT}/earth_cloud.jpg`),
    loadTexture(`${EARTH_TEXTURE_ROOT}/earth_night_4096.jpg`, {
      colorSpace: THREE.SRGBColorSpace,
    }),
  ]);

  tuneTexture(dayTexture);
  tuneTexture(surfaceControlTexture);
  tuneTexture(displacementTexture);
  tuneTexture(normalTexture);
  tuneTexture(cloudTexture);
  tuneTexture(nightTexture);

  const sunDirection = new THREE.Vector3(0.536, 0.343, 0.772);
  const sphereGeometry = new THREE.SphereGeometry(1, 96, 96);
  const { globeMaterial, materialUniforms } = createGlobeMaterial(
    dayTexture,
    surfaceControlTexture,
    displacementTexture,
    normalTexture,
    cloudTexture,
    nightTexture,
    sunDirection,
  );
  const cloudMaterial = createCloudMaterial(cloudTexture, materialUniforms);

  const globe = new THREE.Mesh(sphereGeometry, globeMaterial);
  globe.name = 'procedural-earth-globe';

  const clouds = new THREE.Mesh(sphereGeometry, cloudMaterial);
  clouds.name = 'procedural-earth-clouds';
  clouds.scale.setScalar(1.012);

  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColorDay: materialUniforms.uAtmosphereDay,
      uColorTwilight: materialUniforms.uAtmosphereTwilight,
      uStrength: materialUniforms.uAtmosphereStrength,
    },
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });

  const atmosphere = new THREE.Mesh(sphereGeometry, atmosphereMaterial);
  atmosphere.name = 'procedural-earth-atmosphere';
  atmosphere.scale.setScalar(1.04);

  const group = new THREE.Group();
  group.name = 'procedural-earth';
  group.add(globe, clouds, atmosphere);

  return {
    group,
    sunDirection,
    globeMaterial,
    cloudMaterial,
    atmosphereMaterial,
    materialUniforms,
  };
}
