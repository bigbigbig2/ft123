import * as THREE from 'three';
import compositeVert from '../shaders/composite.vert.glsl?raw';
import compositeFrag from '../shaders/composite.frag.glsl?raw';
import type { EngineView } from '../core/Engine';
import type { SceneBase } from '../scenes/SceneBase';
import { ScenePostProcessor } from '../render/ScenePostProcessor';

/**
 * 渲染层接口：定义了一个可以被 TransitionRenderer 渲染的图层
 */
export interface RenderLayer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  update?(delta: number, elapsed: number): void;
  setSize?(width: number, height: number): void;
  dispose?(): void;
}

/**
 * TransitionRenderer 配置项
 */
export interface TransitionRendererOptions {
  scrollTexture: THREE.Texture;     // 滚动噪波纹理，用于控制混合边缘的抖动
  blueNoiseTexture: THREE.Texture; // 蓝噪纹理，用于画面抖动和抗色阶
  backdrop?: RenderLayer;          // 共享背景层
  chromaticStrength?: number;      // 色散强度
  edgeSoftness?: number;           // 边缘软化度
}

/**
 * 调试参数面板数据
 */
export interface TransitionDebugParams {
  chromaticStrength: number;
  edgeSoftness: number;
  smearStrength: number;    // 拖影强度
  smearLength: number;      // 拖影长度
  smearAngle: number;       // 拖影方向
  fogWashStrength: number;  // 雾气冲刷强度
  sceneBRevealStart: number; // 场景 B 显现的起点（在混合过程中）
}

/** 辅助方法：创建 WebGL 渲染目标 */
function createRenderTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
    samples: 4,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  target.texture.generateMipmaps = false; // 渲染目标通常不需要 Mipmaps
  return target;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/**
 * TransitionRenderer 类：负责场景的合成与转场效果。
 *
 * 核心原理：
 * 1. 离屏渲染 (Off-screen Rendering)：将背景层、场景 A、场景 B 分别渲染到三个不同的离屏缓冲区 (RenderTarget)。
 * 2. 最终合成 (Compositing)：使用一个全屏 Quad（四边形）配合自定义 Shader (compositeFrag)，
 *    根据 mix (混合系数) 和 velocity (滚动速度) 将上述缓冲区内容合成，并施加拖影、色散、噪点等后处理效果。
 */
export class TransitionRenderer implements EngineView {
  readonly name = 'transition-renderer';

  // 用于最终合成的全屏场景
  private compositeScene = new THREE.Scene();
  private compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private compositeMaterial: THREE.ShaderMaterial;
  private compositeQuad: THREE.Mesh;

  // 离屏缓冲区
  private renderTargetBackdrop: THREE.WebGLRenderTarget;
  private renderTargetA: THREE.WebGLRenderTarget;
  private renderTargetB: THREE.WebGLRenderTarget;
  private scenePostProcessor = new ScenePostProcessor();

  private backdrop: RenderLayer | null;
  private sceneA: SceneBase | null = null;
  private sceneB: SceneBase | null = null;
  private mix = 0;
  private velocity = 0;

  private size = { width: 1, height: 1, pixelRatio: 1 };
  private blueOffset = new THREE.Vector2(); // 蓝噪偏移，每帧移动以产生动态颗粒感

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
      smearAngle: 1.5708, // 默认为 90度 (Math.PI/2)，产生垂直向下的拖尾效果
      fogWashStrength: 0.88,
      sceneBRevealStart: 0.28,
    };

    // 初始化合成材质，所有后处理 Uniforms 都定义在这里
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
        uProgressVel: { value: 0 }, // 滚动速度，直接控制拖影强度
        uHomeChromaticStrength: { value: this.debugParams.chromaticStrength },
        uHomeEdgeSoftness: { value: this.debugParams.edgeSoftness },
        uSceneMistStrength: { value: 0 }, // 雾化强度（通常来自地球场景）
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

  /** 设置当前参与混合的两个场景 */
  setSceneTargets(sceneA: SceneBase, sceneB: SceneBase) {
    this.sceneA = sceneA;
    this.sceneB = sceneB;
  }

  /** 更新混合比例和瞬时滚动速度 */
  setMix(mix: number, velocity = 0) {
    this.mix = clamp01(mix);
    this.velocity = clamp01(velocity);
  }

  /** 响应尺寸变化，调整离屏缓冲区尺寸 */
  setSize(width: number, height: number, pixelRatio = 1) {
    this.size.width = width;
    this.size.height = height;
    this.size.pixelRatio = pixelRatio;

    const rw = Math.max(1, Math.round(width * pixelRatio));
    const rh = Math.max(1, Math.round(height * pixelRatio));
    this.renderTargetBackdrop.setSize(rw, rh);
    this.renderTargetA.setSize(rw, rh);
    this.renderTargetB.setSize(rw, rh);
    this.scenePostProcessor.setSize(rw, rh);
    this.compositeMaterial.uniforms.uResolution.value.set(rw, rh);
    this.backdrop?.setSize?.(rw, rh);
  }

  // --- Setter 方法（供 GUI 或外部调用） ---
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

  /** 
   * 更新逻辑：驱动各子场景的 update 方法 
   */
  update(delta: number, elapsed: number) {
    this.backdrop?.update?.(delta, elapsed);
    this.sceneA?.update(delta, elapsed);

    // 性能优化：只有在转场期（mix > 0）才更新场景 B
    if (this.shouldRenderSceneB()) {
      this.sceneB?.update(delta, elapsed);
    }

    // 确保子场景的相机等参数能跟上最新的视口尺寸
    this.sceneA?.setSize(this.size.width, this.size.height);
    if (this.shouldRenderSceneB()) {
      this.sceneB?.setSize(this.size.width, this.size.height);
    }
  }

  /**
   * 渲染核心逻辑
   */
  render(renderer: THREE.WebGLRenderer) {
    if (!this.sceneA) return;

    // 1. 暂存当前渲染器状态
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();

    // 2. 开启手动清理模式，精确控制每一个 Target 的清理
    renderer.autoClear = false;

    // 3. 将背景渲染到 backdrop RT
    this.renderBackdropToTarget(renderer, this.renderTargetBackdrop);
    // 4. 将场景 A 渲染到 RT A
    this.renderForegroundToTarget(renderer, this.sceneA, this.renderTargetA);

    // 5. 如果处于转场，将场景 B 渲染到 RT B
    if (this.shouldRenderSceneB() && this.sceneB) {
      this.renderForegroundToTarget(renderer, this.sceneB, this.renderTargetB);
      this.compositeMaterial.uniforms.tSceneB.value = this.renderTargetB.texture;
    } else {
      // 没转场时，场景 B 保持和 A 一致（或为空），防止渲染错误
      this.compositeMaterial.uniforms.tSceneB.value = this.renderTargetA.texture;
    }

    // 6. 合成阶段：设置 Uniforms
    const uniforms = this.compositeMaterial.uniforms;
    uniforms.tBackdrop.value = this.renderTargetBackdrop.texture;
    uniforms.tSceneA.value = this.renderTargetA.texture;
    uniforms.uMix.value = this.mix;
    uniforms.uProgressVel.value = this.velocity;

    // 更新蓝噪偏移，实现动态胶片噪点感
    this.blueOffset.set(
      (this.blueOffset.x + 0.61803398875) % 1,
      (this.blueOffset.y + 0.41421356237) % 1,
    );
    uniforms.uBlueOffset.value.copy(this.blueOffset);

    // 7. 最终绘制到屏幕（或之前的 RenderTarget）
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(this.compositeScene, this.compositeCamera);

    // 8. 恢复渲染器原始状态
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
  }

  /** 清理内存 */
  dispose() {
    this.renderTargetBackdrop.dispose();
    this.renderTargetA.dispose();
    this.renderTargetB.dispose();
    this.scenePostProcessor.dispose();
    this.compositeQuad.geometry.dispose();
    this.compositeMaterial.dispose();
    this.backdrop?.dispose?.();
  }

  /** 判断是否需要渲染场景 B */
  private shouldRenderSceneB() {
    return Boolean(this.sceneB && this.sceneB !== this.sceneA && this.mix > 0.001);
  }

  /** 背景图层渲染辅助方法 */
  private renderBackdropToTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0xd7e0ec, 1); // 默认天空蓝背景底色
    renderer.clear(true, true, true);

    if (this.backdrop) {
      renderer.render(this.backdrop.scene, this.backdrop.camera);
    }
  }

  /** 前景图层（业务场景）渲染辅助方法 */
  private renderForegroundToTarget(
    renderer: THREE.WebGLRenderer,
    layer: RenderLayer,
    target: THREE.WebGLRenderTarget,
  ) {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0); // 前景必须透明，以便合成
    renderer.clear(true, true, true);
    renderer.render(layer.scene, layer.camera);
    this.scenePostProcessor.renderSceneEffects(renderer, layer as SceneBase, target);
  }
}
