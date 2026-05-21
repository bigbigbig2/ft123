import * as THREE from 'three';
import type {
  PostProcessableScene,
  SceneBase,
  SceneBloomEffect,
  ScenePostEffects,
} from '../scenes/SceneBase';

const DEFAULT_BLOOM_SCALE = 0.5;
const DEFAULT_BLOOM_STRENGTH = 1.2;
const DEFAULT_BLOOM_RADIUS = 5.5;

function createRenderTarget(width: number, height: number, depthBuffer = false) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer,
    stencilBuffer: false,
    samples: 0,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  target.texture.generateMipmaps = false;
  return target;
}

function isPostProcessableScene(scene: SceneBase): scene is PostProcessableScene {
  return typeof (scene as Partial<PostProcessableScene>).getPostEffects === 'function';
}

function getScenePostEffects(scene: SceneBase): ScenePostEffects | null {
  return isPostProcessableScene(scene) ? scene.getPostEffects() : null;
}

export class ScenePostProcessor {
  private fullWidth = 1;
  private fullHeight = 1;
  private bloomWidth = 1;
  private bloomHeight = 1;
  private bloomScale = DEFAULT_BLOOM_SCALE;

  private bloomSource = createRenderTarget(1, 1, true);
  private blurPing = createRenderTarget(1, 1);
  private blurPong = createRenderTarget(1, 1);

  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private blurMaterial: THREE.ShaderMaterial;
  private compositeMaterial: THREE.ShaderMaterial;
  private tintColor = new THREE.Color(0xffffff);

  constructor() {
    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tInput;
        uniform vec2 uResolution;
        uniform vec2 uDirection;
        uniform float uRadius;
        varying vec2 vUv;

        void main() {
          vec2 texel = uDirection * uRadius / max(uResolution, vec2(1.0));
          vec4 color = vec4(0.0);
          color += texture2D(tInput, vUv - texel * 4.0) * 0.051;
          color += texture2D(tInput, vUv - texel * 3.0) * 0.0918;
          color += texture2D(tInput, vUv - texel * 2.0) * 0.12245;
          color += texture2D(tInput, vUv - texel) * 0.1531;
          color += texture2D(tInput, vUv) * 0.1633;
          color += texture2D(tInput, vUv + texel) * 0.1531;
          color += texture2D(tInput, vUv + texel * 2.0) * 0.12245;
          color += texture2D(tInput, vUv + texel * 3.0) * 0.0918;
          color += texture2D(tInput, vUv + texel * 4.0) * 0.051;
          gl_FragColor = color;
        }
      `,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        tInput: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uRadius: { value: DEFAULT_BLOOM_RADIUS },
      },
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tBloom;
        uniform vec3 uTint;
        uniform float uStrength;
        varying vec2 vUv;

        void main() {
          vec4 bloom = texture2D(tBloom, vUv);
          gl_FragColor = vec4(bloom.rgb * uTint * uStrength, bloom.a * uStrength);
        }
      `,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        tBloom: { value: null },
        uTint: { value: this.tintColor },
        uStrength: { value: DEFAULT_BLOOM_STRENGTH },
      },
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
    this.quadScene.add(this.quad);
  }

  setSize(width: number, height: number) {
    this.fullWidth = Math.max(1, Math.round(width));
    this.fullHeight = Math.max(1, Math.round(height));
    this.ensureBloomTargets(this.bloomScale);
  }

  renderSceneEffects(
    renderer: THREE.WebGLRenderer,
    scene: SceneBase,
    outputTarget: THREE.WebGLRenderTarget,
  ) {
    const effects = getScenePostEffects(scene);
    const bloom = effects?.bloom;
    if (!bloom?.enabled) return;

    this.renderBloom(renderer, scene, outputTarget, bloom);
  }

  dispose() {
    this.bloomSource.dispose();
    this.blurPing.dispose();
    this.blurPong.dispose();
    this.quad.geometry.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
  }

  private renderBloom(
    renderer: THREE.WebGLRenderer,
    scene: SceneBase,
    outputTarget: THREE.WebGLRenderTarget,
    bloom: SceneBloomEffect,
  ) {
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();
    const previousCameraMask = scene.camera.layers.mask;

    this.ensureBloomTargets(bloom.resolutionScale ?? DEFAULT_BLOOM_SCALE);
    renderer.autoClear = false;

    scene.camera.layers.set(bloom.layer);
    renderer.setRenderTarget(this.bloomSource);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene.scene, scene.camera);
    scene.camera.layers.mask = previousCameraMask;

    this.renderBlurPass(renderer, this.bloomSource.texture, this.blurPing, 1, 0, bloom);
    this.renderBlurPass(renderer, this.blurPing.texture, this.blurPong, 0, 1, bloom);

    this.quad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.tBloom.value = this.blurPong.texture;
    this.compositeMaterial.uniforms.uStrength.value = bloom.strength ?? DEFAULT_BLOOM_STRENGTH;
    this.tintColor.set(bloom.tint ?? 0xffffff);

    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
  }

  private renderBlurPass(
    renderer: THREE.WebGLRenderer,
    input: THREE.Texture,
    target: THREE.WebGLRenderTarget,
    directionX: number,
    directionY: number,
    bloom: SceneBloomEffect,
  ) {
    this.quad.material = this.blurMaterial;
    this.blurMaterial.uniforms.tInput.value = input;
    this.blurMaterial.uniforms.uResolution.value.set(this.bloomWidth, this.bloomHeight);
    this.blurMaterial.uniforms.uDirection.value.set(directionX, directionY);
    this.blurMaterial.uniforms.uRadius.value = bloom.radius ?? DEFAULT_BLOOM_RADIUS;

    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(this.quadScene, this.quadCamera);
  }

  private ensureBloomTargets(scale: number) {
    const nextScale = THREE.MathUtils.clamp(scale, 0.125, 1);
    const nextWidth = Math.max(1, Math.round(this.fullWidth * nextScale));
    const nextHeight = Math.max(1, Math.round(this.fullHeight * nextScale));

    if (
      nextWidth === this.bloomWidth &&
      nextHeight === this.bloomHeight &&
      nextScale === this.bloomScale
    ) {
      return;
    }

    this.bloomScale = nextScale;
    this.bloomWidth = nextWidth;
    this.bloomHeight = nextHeight;
    this.bloomSource.setSize(nextWidth, nextHeight);
    this.blurPing.setSize(nextWidth, nextHeight);
    this.blurPong.setSize(nextWidth, nextHeight);
  }
}
