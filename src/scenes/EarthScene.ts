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

  uniform vec3 uColor;
  uniform vec3 uSunDirection;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - abs(dot(viewDirection, normalize(vNormal))), 2.7);
    float sunStrength = smoothstep(-0.45, 0.85, dot(normalize(vNormal), normalize(uSunDirection)));
    float alpha = fresnel * sunStrength * 0.68;
    gl_FragColor = vec4(uColor, alpha);
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

  void main() {
    float clouds = texture2D(tCloudData, vUv).b;
    float alpha = smoothstep(0.28, 0.78, clouds) * 0.48;
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
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.side = THREE.DoubleSide;
      material.transparent = true;
      material.opacity = 0.95;
      material.needsUpdate = true;
    }
  });
}

function tuneTexture(texture: THREE.Texture, anisotropy = 8) {
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
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

  const sunDirection = new THREE.Vector3(0.25, 0.28, 1).normalize();
  const sphereGeometry = new THREE.SphereGeometry(1, 96, 96);

  const globeMaterial = new THREE.MeshStandardMaterial({
    map: dayTexture,
    bumpMap: bumpRoughnessCloudsTexture,
    bumpScale: 0.045,
    roughnessMap: bumpRoughnessCloudsTexture,
    roughness: 0.55,
    metalness: 0,
  });

  const globe = new THREE.Mesh(sphereGeometry, globeMaterial);
  globe.name = 'procedural-earth-globe';

  const clouds = new THREE.Mesh(
    sphereGeometry,
    new THREE.ShaderMaterial({
      uniforms: {
        tCloudData: { value: bumpRoughnessCloudsTexture },
        uSunDirection: { value: sunDirection },
      },
      vertexShader: CLOUD_VERTEX_SHADER,
      fragmentShader: CLOUD_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  clouds.name = 'procedural-earth-clouds';
  clouds.scale.setScalar(1.012);

  const atmosphere = new THREE.Mesh(
    sphereGeometry,
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color('#4db2ff') },
        uSunDirection: { value: sunDirection },
      },
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  atmosphere.name = 'procedural-earth-atmosphere';
  atmosphere.scale.setScalar(1.055);

  const group = new THREE.Group();
  group.name = 'procedural-earth';
  group.add(globe, clouds, atmosphere);

  return { group, sunDirection };
}

export async function createEarthScene() {
  const scene = new ModelScene({
    name: 'earth',
    fov: 31,
    cameraPosition: [0, 0.34, 4.35],
    cameraLookAt: [0, 0, 0],
    autoRotateSpeed: 0.08,
  });

  const [earth, ring, text] = await Promise.all([
    createProceduralEarth(),
    loadGLTF(`${EARTH_MODEL_ROOT}/huan.gltf`),
    loadGLTF(`${EARTH_MODEL_ROOT}/wenzi.gltf`),
  ]);

  const sun = new THREE.DirectionalLight('#ffffff', 0.5);
  sun.position.copy(earth.sunDirection).multiplyScalar(6);
  scene.scene.add(sun);

  const ringMaterial = new THREE.MeshPhysicalMaterial({
    color: '#c5faff',
    emissive: '#85f5ff',
    emissiveIntensity: 0.22,
    transmission: 0.38,
    thickness: 0.18,
    transparent: true,
    opacity: 0.62,
    roughness: 0.24,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  setMaterial(ring.scene, ringMaterial);
  normalizeText(text.scene);

  const root = new THREE.Group();
  root.name = 'earth-model-root';
  root.add(earth.group, ring.scene, text.scene);

  scene.attachAndFit(root, 2.55);
  scene.modelRoot.rotation.x = -0.08;

  return scene;
}
