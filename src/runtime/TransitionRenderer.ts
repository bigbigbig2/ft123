import * as THREE from 'three';
import compositeVert from '../shaders/composite.vert.glsl?raw';
import compositeFrag from '../shaders/composite.frag.glsl?raw';
import type { EngineView } from '../core/Engine';
import type { SceneBase } from '../scenes/SceneBase';

export interface RenderLayer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  update?(delta: number, elapsed: number): void;
  setSize?(width: number, height: number): void;
  dispose?(): void;
}

export interface TransitionRendererOptions {
  scrollTexture: THREE.Texture;
  blueNoiseTexture: THREE.Texture;
  backdrop?: RenderLayer;
  chromaticStrength?: number;
  edgeSoftness?: number;
}

export interface TransitionDebugParams {
  chromaticStrength: number;
  edgeSoftness: number;
  smearStrength: number;
  smearLength: number;
  smearAngle: number;
  fogWashStrength: number;
  sceneBRevealStart: number;
}

function createRenderTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  target.texture.generateMipmaps = false;
  return target;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export class TransitionRenderer implements EngineView {
  readonly name = 'transition-renderer';

  private compositeScene = new THREE.Scene();
  private compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private compositeMaterial: THREE.ShaderMaterial;
  private compositeQuad: THREE.Mesh;

  private renderTargetBackdrop: THREE.WebGLRenderTarget;
  private renderTargetA: THREE.WebGLRenderTarget;
  private renderTargetB: THREE.WebGLRenderTarget;

  private backdrop: RenderLayer | null;
  private sceneA: SceneBase | null = null;
  private sceneB: SceneBase | null = null;
  private mix = 0;
  private velocity = 0;

  private size = { width: 1, height: 1, pixelRatio: 1 };
  private blueOffset = new THREE.Vector2();

  private debugParams: TransitionDebugParams;

  constructor(opts: TransitionRendererOptions) {
    this.backdrop = opts.backdrop ?? null;
    this.renderTargetBackdrop = createRenderTarget(1, 1);
    this.renderTargetA = createRenderTarget(1, 1);
    this.renderTargetB = createRenderTarget(1, 1);

    this.debugParams = {
      chromaticStrength: opts.chromaticStrength ?? 0.58,
      edgeSoftness: opts.edgeSoftness ?? 1,
      smearStrength: 0.78,
      smearLength: 0.18,
      smearAngle: 1.5708, // 改为 90度 (Math.PI/2)，强制垂直上下拖尾
      fogWashStrength: 0.88,
      sceneBRevealStart: 0.62,
    };

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: compositeVert,
      fragmentShader: compositeFrag,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        tBackdrop: { value: null },
        tSceneA: { value: null },
        tSceneB: { value: null },
        tScroll: { value: opts.scrollTexture },
        tBlue: { value: opts.blueNoiseTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uBlueOffset: { value: this.blueOffset.clone() },
        uMix: { value: 0 },
        uProgressVel: { value: 0 },
        uHomeChromaticStrength: { value: this.debugParams.chromaticStrength },
        uHomeEdgeSoftness: { value: this.debugParams.edgeSoftness },
        uSceneMistStrength: { value: 0 },
        uSmearStrength: { value: this.debugParams.smearStrength },
        uSmearLength: { value: this.debugParams.smearLength },
        uSmearAngle: { value: this.debugParams.smearAngle },
        uFogWashStrength: { value: this.debugParams.fogWashStrength },
        uSceneBRevealStart: { value: this.debugParams.sceneBRevealStart },
      },
    });

    this.compositeQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.compositeMaterial,
    );
    this.compositeScene.add(this.compositeQuad);
  }

  setSceneTargets(sceneA: SceneBase, sceneB: SceneBase) {
    this.sceneA = sceneA;
    this.sceneB = sceneB;
  }

  setMix(mix: number, velocity = 0) {
    this.mix = clamp01(mix);
    this.velocity = clamp01(velocity);
  }

  setSize(width: number, height: number, pixelRatio = 1) {
    this.size.width = width;
    this.size.height = height;
    this.size.pixelRatio = pixelRatio;

    const rw = Math.max(1, Math.round(width * pixelRatio));
    const rh = Math.max(1, Math.round(height * pixelRatio));
    this.renderTargetBackdrop.setSize(rw, rh);
    this.renderTargetA.setSize(rw, rh);
    this.renderTargetB.setSize(rw, rh);
    this.compositeMaterial.uniforms.uResolution.value.set(rw, rh);
    this.backdrop?.setSize?.(rw, rh);
  }

  setChromaticStrength(value: number) {
    this.debugParams.chromaticStrength = value;
    this.compositeMaterial.uniforms.uHomeChromaticStrength.value = value;
  }

  setEdgeSoftness(value: number) {
    this.debugParams.edgeSoftness = value;
    this.compositeMaterial.uniforms.uHomeEdgeSoftness.value = value;
  }

  setSmearStrength(value: number) {
    this.debugParams.smearStrength = value;
    this.compositeMaterial.uniforms.uSmearStrength.value = value;
  }

  setSmearLength(value: number) {
    this.debugParams.smearLength = value;
    this.compositeMaterial.uniforms.uSmearLength.value = value;
  }

  setSmearAngle(value: number) {
    this.debugParams.smearAngle = value;
    this.compositeMaterial.uniforms.uSmearAngle.value = value;
  }

  setFogWashStrength(value: number) {
    this.debugParams.fogWashStrength = value;
    this.compositeMaterial.uniforms.uFogWashStrength.value = value;
  }

  setSceneBRevealStart(value: number) {
    this.debugParams.sceneBRevealStart = value;
    this.compositeMaterial.uniforms.uSceneBRevealStart.value = value;
  }

  getDebugParams(): TransitionDebugParams {
    return { ...this.debugParams };
  }

  setSceneMistStrength(value: number) {
    this.compositeMaterial.uniforms.uSceneMistStrength.value = clamp01(value);
  }

  update(delta: number, elapsed: number) {
    this.backdrop?.update?.(delta, elapsed);
    this.sceneA?.update(delta, elapsed);

    if (this.shouldRenderSceneB()) {
      this.sceneB?.update(delta, elapsed);
    }

    this.sceneA?.setSize(this.size.width, this.size.height);
    if (this.shouldRenderSceneB()) {
      this.sceneB?.setSize(this.size.width, this.size.height);
    }
  }

  render(renderer: THREE.WebGLRenderer) {
    if (!this.sceneA) return;

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();

    renderer.autoClear = false;

    this.renderBackdropToTarget(renderer, this.renderTargetBackdrop);
    this.renderForegroundToTarget(renderer, this.sceneA, this.renderTargetA);

    if (this.shouldRenderSceneB() && this.sceneB) {
      this.renderForegroundToTarget(renderer, this.sceneB, this.renderTargetB);
      this.compositeMaterial.uniforms.tSceneB.value = this.renderTargetB.texture;
    } else {
      this.compositeMaterial.uniforms.tSceneB.value = this.renderTargetA.texture;
    }

    const uniforms = this.compositeMaterial.uniforms;
    uniforms.tBackdrop.value = this.renderTargetBackdrop.texture;
    uniforms.tSceneA.value = this.renderTargetA.texture;
    uniforms.uMix.value = this.mix;
    uniforms.uProgressVel.value = this.velocity;

    this.blueOffset.set(
      (this.blueOffset.x + 0.61803398875) % 1,
      (this.blueOffset.y + 0.41421356237) % 1,
    );
    uniforms.uBlueOffset.value.copy(this.blueOffset);

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(this.compositeScene, this.compositeCamera);

    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
  }

  dispose() {
    this.renderTargetBackdrop.dispose();
    this.renderTargetA.dispose();
    this.renderTargetB.dispose();
    this.compositeQuad.geometry.dispose();
    this.compositeMaterial.dispose();
    this.backdrop?.dispose?.();
  }

  private shouldRenderSceneB() {
    return Boolean(this.sceneB && this.sceneB !== this.sceneA && this.mix > 0.001);
  }

  private renderBackdropToTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0xd7e0ec, 1);
    renderer.clear(true, true, true);

    if (this.backdrop) {
      renderer.render(this.backdrop.scene, this.backdrop.camera);
    }
  }

  private renderForegroundToTarget(
    renderer: THREE.WebGLRenderer,
    layer: RenderLayer,
    target: THREE.WebGLRenderTarget,
  ) {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(layer.scene, layer.camera);
  }
}
