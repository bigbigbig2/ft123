import * as THREE from 'three';
import {
  BlendFunction,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import type { ScenePostPipeline } from '../SceneBase';
import type { Scene3DebugPostState } from '../Scene3CityScene';

const TONE_MAPPING_MODES: Record<Scene3DebugPostState['toneMappingMode'], ToneMappingMode> = {
  LINEAR: ToneMappingMode.LINEAR,
  REINHARD: ToneMappingMode.REINHARD,
  REINHARD2: ToneMappingMode.REINHARD2,
  UNCHARTED2: ToneMappingMode.UNCHARTED2,
  CINEON: ToneMappingMode.CINEON,
  ACES_FILMIC: ToneMappingMode.ACES_FILMIC,
  AGX: ToneMappingMode.AGX,
  NEUTRAL: ToneMappingMode.NEUTRAL,
};

export class Scene3PostPipeline implements ScenePostPipeline {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private toneMappingEffect: ToneMappingEffect;
  private effectPass: EffectPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly settings: Scene3DebugPostState,
  ) {
    this.composer = new EffectComposer(renderer, {
      depthBuffer: true,
      stencilBuffer: false,
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    this.composer.autoRenderToScreen = false;

    this.renderPass = new RenderPass(scene, camera);
    this.renderPass.ignoreBackground = true;
    this.renderPass.clearPass.overrideClearColor = new THREE.Color(0x000000);
    this.renderPass.clearPass.overrideClearAlpha = 0;

    this.toneMappingEffect = new ToneMappingEffect({
      blendFunction: BlendFunction.SRC,
      mode: this.getToneMappingMode(),
    });

    this.effectPass = new EffectPass(camera, this.toneMappingEffect);
    this.effectPass.renderToScreen = false;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.effectPass);
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height, false);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, delta: number) {
    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();
    const previousToneMappingExposure = renderer.toneMappingExposure;
    const previousOutputBuffer = this.composer.outputBuffer;

    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);

    if (!this.settings.enabled) {
      renderer.render(this.scene, this.camera);
    } else {
      this.toneMappingEffect.mode = this.getToneMappingMode();
      renderer.toneMappingExposure = this.settings.exposure;
      this.composer.outputBuffer = target;
      this.composer.render(delta);
    }

    this.composer.outputBuffer = previousOutputBuffer;
    renderer.toneMappingExposure = previousToneMappingExposure;
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
  }

  dispose() {
    this.composer.dispose();
  }

  private getToneMappingMode() {
    return TONE_MAPPING_MODES[this.settings.toneMappingMode] ?? ToneMappingMode.ACES_FILMIC;
  }
}
