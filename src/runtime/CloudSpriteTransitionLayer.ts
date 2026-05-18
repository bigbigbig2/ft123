import * as THREE from 'three';

export interface CloudSpriteTransitionAssets {
  fillTexture: THREE.Texture;
  noiseTexture: THREE.Texture;
  layerTextures: THREE.Texture[];
  foregroundTexture: THREE.Texture;
}

export interface CloudSpriteDebugParams {
  enabled: boolean;
  opacity: number;
  fillOpacity: number;
  layerOpacity: number;
  foregroundOpacity: number;
  fillCount: number;
  width: number;
  depth: number;
  baseY: number;
  fillScale: number;
  randomScale: number;
  cameraDrift: number;
  zDrift: number;
  noiseStrength: number;
  noiseSpeed: number;
  alphaNoise: number;
  edgeSoftness: number;
  brightness: number;
  tint: string;
  tintStrength: number;
  enterStart: number;
  enterEnd: number;
  exitStart: number;
  exitEnd: number;
}

const DEFAULT_PARAMS: CloudSpriteDebugParams = {
  enabled: true,
  opacity: 0.86,
  fillOpacity: 0.62,
  layerOpacity: 0.24,
  foregroundOpacity: 0.08,
  fillCount: 260,
  width: 1650,
  depth: 1320,
  baseY: -88,
  fillScale: 44,
  randomScale: 30,
  cameraDrift: 26,
  zDrift: 0,
  noiseStrength: 0.72,
  noiseSpeed: 0.22,
  alphaNoise: 0.35,
  edgeSoftness: 0.12,
  brightness: 1.02,
  tint: '#f3f8ff',
  tintStrength: 0.1,
  enterStart: 0.12,
  enterEnd: 0.48,
  exitStart: 0.84,
  exitEnd: 1,
};

export function getDefaultCloudSpriteDebugParams(): CloudSpriteDebugParams {
  return { ...DEFAULT_PARAMS };
}

const cloudVertexShader = `
varying vec2 vUv;
varying float vViewZ;

void main() {
  vUv = uv;

  mat4 cloudInstanceMatrix = mat4(1.0);
  #ifdef USE_INSTANCING
    cloudInstanceMatrix = instanceMatrix;
  #endif

  vec4 worldPosition = modelMatrix * cloudInstanceMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  vViewZ = -mvPosition.z;

  gl_Position = projectionMatrix * mvPosition;
}
`;

const cloudFragmentShader = `
uniform sampler2D uMap;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uOpacity;
uniform float uNoiseStrength;
uniform float uNoiseSpeed;
uniform float uAlphaNoise;
uniform float uEdgeSoftness;
uniform float uBrightness;
uniform vec3 uTint;
uniform float uTintStrength;
uniform float uFadeNear;
uniform float uFadeFar;

varying vec2 vUv;
varying float vViewZ;

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

void main() {
  float time = uTime * uNoiseSpeed;
  vec2 noiseUv1 = vUv * vec2(3.0, 3.0) + vec2(time * 0.18, 0.0);
  vec2 noiseUv2 = vUv * vec2(2.8, 3.5) + vec2(time * 0.12, time * 0.03);
  vec2 uvShift1 = (texture2D(uNoise, noiseUv1).rg - 0.5) * 0.006 * uNoiseStrength;
  vec2 uvShift2 = (texture2D(uNoise, noiseUv2).rg - 0.5) * 0.012 * uNoiseStrength;

  vec4 cloud = texture2D(uMap, vUv + uvShift1 + uvShift2);
  float edge = smoothstep(0.0, max(0.001, uEdgeSoftness), cloud.a);
  float alphaNoise = 1.0 - (texture2D(uNoise, vUv * vec2(5.0, 2.0) + vec2(time * 0.22)).g - 0.5) * uAlphaNoise;
  cloud.a = saturate(cloud.a * edge * alphaNoise);

  float depthFade = smoothstep(uFadeNear, uFadeFar, vViewZ);
  vec3 color = cloud.rgb * uBrightness;
  color = mix(color, color * uTint, uTintStrength);

  float alpha = cloud.a * depthFade * uOpacity;
  if (alpha < 0.002) discard;

  gl_FragColor = vec4(color, alpha);
}
`;

interface CloudLayerPlane {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  basePosition: THREE.Vector3;
  drift: number;
}

function makeSeededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export class CloudSpriteTransitionLayer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2200);

  private geometry = new THREE.PlaneGeometry(1, 1);
  private fillMaterial: THREE.ShaderMaterial;
  private layerMaterial: THREE.ShaderMaterial;
  private foregroundMaterial: THREE.ShaderMaterial;
  private layerMaterials: THREE.ShaderMaterial[] = [];
  private fillMesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private planes: CloudLayerPlane[] = [];
  private tintColor = new THREE.Color(DEFAULT_PARAMS.tint);
  private params: CloudSpriteDebugParams = { ...DEFAULT_PARAMS };
  private matrices: THREE.Matrix4[] = [];
  private size = { width: 1, height: 1 };
  private progress = 0;
  private time = 0;

  constructor(private assets: CloudSpriteTransitionAssets) {
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, 1);

    this.fillMaterial = this.createMaterial(assets.fillTexture, this.params.fillOpacity);
    this.layerMaterial = this.createMaterial(assets.layerTextures[0] ?? assets.fillTexture, this.params.layerOpacity);
    this.foregroundMaterial = this.createMaterial(assets.foregroundTexture, this.params.foregroundOpacity);
    this.layerMaterials.push(this.layerMaterial);

    this.fillMesh = new THREE.InstancedMesh(this.geometry, this.fillMaterial, 260);
    this.fillMesh.frustumCulled = false;
    this.fillMesh.renderOrder = 20;
    this.scene.add(this.fillMesh);

    this.createLayerPlanes();
    this.rebuildFillClouds();
    this.applyDebugParams(this.params);
  }

  setSize(width: number, height: number) {
    this.size.width = Math.max(1, width);
    this.size.height = Math.max(1, height);
    this.camera.aspect = this.size.width / this.size.height;
    this.camera.updateProjectionMatrix();
  }

  setProgress(progress: number) {
    this.progress = THREE.MathUtils.clamp(progress, 0, 1);
    this.updateVisibility();

    const eased = smoothstep(0, 1, this.progress);
    const cameraY = THREE.MathUtils.lerp(this.params.baseY + 10, this.params.baseY + 170, eased);
    const cameraZ = THREE.MathUtils.lerp(-120, -120 - this.params.cameraDrift, eased);
    const lookY = THREE.MathUtils.lerp(this.params.baseY - 75, this.params.baseY - 145, eased);
    const lookZ = THREE.MathUtils.lerp(280, 560, eased);
    this.camera.position.set(0, cameraY, cameraZ);
    this.camera.lookAt(0, lookY, lookZ);

    const zOffset = (eased - 0.5) * this.params.zDrift;
    this.fillMesh.position.z = zOffset;
    for (const plane of this.planes) {
      plane.mesh.position.copy(plane.basePosition);
      plane.mesh.position.z += zOffset * plane.drift;
    }
  }

  update(delta: number, _elapsed: number) {
    this.time += delta;
    this.setTimeUniform(this.fillMaterial, this.time);
    for (const material of this.layerMaterials) this.setTimeUniform(material, this.time);
    this.setTimeUniform(this.foregroundMaterial, this.time);
  }

  getDebugParams(): CloudSpriteDebugParams {
    return { ...this.params };
  }

  applyDebugParams(params: CloudSpriteDebugParams) {
    const needsRebuild = (
      params.fillCount !== this.params.fillCount ||
      params.width !== this.params.width ||
      params.depth !== this.params.depth ||
      params.baseY !== this.params.baseY ||
      params.fillScale !== this.params.fillScale ||
      params.randomScale !== this.params.randomScale
    );

    this.params = { ...params };
    this.tintColor.set(this.params.tint);
    this.fillMesh.visible = this.params.enabled;
    for (const plane of this.planes) plane.mesh.visible = this.params.enabled;

    if (needsRebuild) {
      this.rebuildFillClouds();
      this.updateLayerPlaneTransforms();
    }

    this.applyMaterialParams(this.fillMaterial, this.params.fillOpacity);
    for (const material of this.layerMaterials) this.applyMaterialParams(material, this.params.layerOpacity);
    this.applyMaterialParams(this.foregroundMaterial, this.params.foregroundOpacity);
    this.setProgress(this.progress);
  }

  dispose() {
    this.geometry.dispose();
    this.fillMaterial.dispose();
    for (const material of this.layerMaterials) material.dispose();
    this.foregroundMaterial.dispose();
  }

  private createMaterial(map: THREE.Texture, opacity: number) {
    const material = new THREE.ShaderMaterial({
      vertexShader: cloudVertexShader,
      fragmentShader: cloudFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: map },
        uNoise: { value: this.assets.noiseTexture },
        uTime: { value: 0 },
        uOpacity: { value: opacity },
        uNoiseStrength: { value: this.params.noiseStrength },
        uNoiseSpeed: { value: this.params.noiseSpeed },
        uAlphaNoise: { value: this.params.alphaNoise },
        uEdgeSoftness: { value: this.params.edgeSoftness },
        uBrightness: { value: this.params.brightness },
        uTint: { value: this.tintColor },
        uTintStrength: { value: this.params.tintStrength },
        uFadeNear: { value: 8 },
        uFadeFar: { value: 60 },
      },
    });
    return material;
  }

  private createLayerPlanes() {
    const layerConfigs = [
      { x: 0, y: -22, z: 120, scale: 300, drift: 0.25, order: 5 },
      { x: -120, y: -34, z: 230, scale: 420, drift: 0.38, order: 8 },
      { x: 130, y: -28, z: 320, scale: 500, drift: 0.45, order: 10 },
      { x: -260, y: -18, z: 420, scale: 580, drift: 0.55, order: 6 },
      { x: 260, y: -16, z: 520, scale: 620, drift: 0.65, order: 7 },
    ];

    for (let i = 0; i < layerConfigs.length; i++) {
      const texture = this.assets.layerTextures[i] ?? this.assets.layerTextures[0] ?? this.assets.fillTexture;
      const material = i === 0 ? this.layerMaterial : this.createMaterial(texture, this.params.layerOpacity);
      if (i !== 0) this.layerMaterials.push(material);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = layerConfigs[i].order;
      this.scene.add(mesh);
      this.planes.push({
        mesh,
        basePosition: new THREE.Vector3(layerConfigs[i].x, layerConfigs[i].y, layerConfigs[i].z),
        drift: layerConfigs[i].drift,
      });
    }

    const foregroundConfigs = [
      { x: -190, y: -58, z: 70, scale: 380, drift: 0.2, order: 30 },
      { x: 180, y: -62, z: 84, scale: 440, drift: 0.18, order: 31 },
    ];

    for (const config of foregroundConfigs) {
      const mesh = new THREE.Mesh(this.geometry, this.foregroundMaterial);
      mesh.frustumCulled = false;
      mesh.renderOrder = config.order;
      this.scene.add(mesh);
      this.planes.push({
        mesh,
        basePosition: new THREE.Vector3(config.x, config.y, config.z),
        drift: config.drift,
      });
    }

    this.updateLayerPlaneTransforms();
  }

  private updateLayerPlaneTransforms() {
    const layerScaleBoost = this.params.width / DEFAULT_PARAMS.width;
    for (const plane of this.planes) {
      const aspect = this.getTextureAspect(plane.mesh.material.uniforms.uMap.value as THREE.Texture);
      const baseScale = plane.basePosition.z < 100 ? 1.08 : layerScaleBoost;
      const height = THREE.MathUtils.clamp(plane.basePosition.z * 0.82, 220, 720) * baseScale;
      plane.mesh.scale.set(height * aspect, height, 1);
      plane.mesh.position.copy(plane.basePosition);
      plane.mesh.position.y += this.params.baseY - DEFAULT_PARAMS.baseY;
    }
  }

  private rebuildFillClouds() {
    const random = makeSeededRandom(7059401);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const count = Math.min(this.params.fillCount, this.fillMesh.count);
    const aspect = this.getTextureAspect(this.assets.fillTexture);

    this.fillMesh.count = count;
    this.matrices.length = 0;

    for (let i = 0; i < count; i++) {
      const depthT = count <= 1 ? 0 : i / (count - 1);
      const x = (random() - random()) * this.params.width;
      const y = this.params.baseY + (random() - random()) * 12 - depthT * 18;
      const z = depthT * this.params.depth + 40;
      const size = this.params.fillScale + random() * this.params.randomScale;
      const flipX = random() > 0.5 ? -1 : 1;
      const flipY = random() > 0.1 ? 1 : -1;
      const rotation = (random() - 0.5) * 0.12;

      position.set(x, y, z);
      quaternion.setFromEuler(new THREE.Euler(0, 0, rotation));
      scale.set(size * aspect * flipX, size * flipY, size);
      matrix.compose(position, quaternion, scale);
      this.fillMesh.setMatrixAt(i, matrix);
      this.matrices.push(matrix.clone());
    }

    this.fillMesh.instanceMatrix.needsUpdate = true;
  }

  private updateVisibility() {
    const enter = smoothstep(this.params.enterStart, this.params.enterEnd, this.progress);
    const exit = 1 - smoothstep(this.params.exitStart, this.params.exitEnd, this.progress);
    const opacity = this.params.enabled ? this.params.opacity * enter * exit : 0;

    this.fillMaterial.uniforms.uOpacity.value = opacity * this.params.fillOpacity;
    for (const plane of this.planes) {
      const material = plane.mesh.material;
      const isForeground = material === this.foregroundMaterial;
      material.uniforms.uOpacity.value = opacity * (isForeground ? this.params.foregroundOpacity : this.params.layerOpacity);
    }
  }

  private applyMaterialParams(material: THREE.ShaderMaterial, opacity: number) {
    material.uniforms.uNoiseStrength.value = this.params.noiseStrength;
    material.uniforms.uNoiseSpeed.value = this.params.noiseSpeed;
    material.uniforms.uAlphaNoise.value = this.params.alphaNoise;
    material.uniforms.uEdgeSoftness.value = this.params.edgeSoftness;
    material.uniforms.uBrightness.value = this.params.brightness;
    material.uniforms.uTint.value.copy(this.tintColor);
    material.uniforms.uTintStrength.value = this.params.tintStrength;
    material.uniforms.uOpacity.value = opacity * this.params.opacity;
  }

  private setTimeUniform(material: THREE.ShaderMaterial, time: number) {
    material.uniforms.uTime.value = time;
  }

  private getTextureAspect(texture: THREE.Texture) {
    const image = texture.image as { width?: number; height?: number } | undefined;
    if (!image?.width || !image?.height) return 2;
    return image.width / image.height;
  }
}
