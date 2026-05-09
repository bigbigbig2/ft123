/**
 * TransitionRenderer.ts — 转场渲染器
 *
 * 实现 EngineView 接口，是引擎的"主视图"。
 * 核心流程：
 * 1. 将当前场景和下一场景分别离屏渲染到两个 RenderTarget
 * 2. 在每个 RT 中先绘制共享背景（SharedBackdrop）
 * 3. 用全屏合成着色器（composite shader）混合两个 RT，
 *    实现带色散、云雾、斜切切割的转场过渡效果
 */
import * as THREE from 'three';
import compositeVert from '../shaders/composite.vert.glsl?raw';
import compositeFrag from '../shaders/composite.frag.glsl?raw';
import type { EngineView } from '../core/Engine';
import type { SceneBase } from '../scenes/SceneBase';

/**
 * 可被 TransitionRenderer 渲染的图层接口
 * 每个图层需要提供自己的 scene 和 camera
 */
export interface RenderLayer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  update?(delta: number, elapsed: number): void;
  setSize?(width: number, height: number): void;
  dispose?(): void;
}

/** TransitionRenderer 构造选项 */
export interface TransitionRendererOptions {
  scrollTexture: THREE.Texture;       // 滚动过渡纹理（用于切割线形状）
  blueNoiseTexture: THREE.Texture;    // 蓝噪声纹理（抖动用）
  backdrop?: RenderLayer;             // 共享背景层（可选）
  chromaticStrength?: number;         // 色散强度（默认 0.58）
  edgeSoftness?: number;              // 切割边缘柔和度（默认 1）
}

/**
 * 创建离屏渲染目标
 * @param width - 宽度（像素）
 * @param height - 高度（像素）
 */
function createRenderTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  return target;
}

/**
 * TransitionRenderer — 转场渲染器
 *
 * 实现双 RT 离屏渲染 + 全屏合成的场景过渡系统。
 * 作为 EngineView 被 Engine 每帧驱动。
 */
export class TransitionRenderer implements EngineView {
  readonly name = 'transition-renderer';

  // ── 合成 pass 相关 ─────────────────────────────────────────────
  /** 合成场景（只含一个全屏四边形） */
  private compositeScene = new THREE.Scene();
  /** 合成用正交相机 */
  private compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** 合成着色器材质 */
  private compositeMaterial: THREE.ShaderMaterial;
  /** 全屏四边形网格 */
  private compositeQuad: THREE.Mesh;

  // ── 离屏渲染目标 ───────────────────────────────────────────────
  /** 场景 A 的 RenderTarget */
  private renderTargetA: THREE.WebGLRenderTarget;
  /** 场景 B 的 RenderTarget */
  private renderTargetB: THREE.WebGLRenderTarget;

  // ── 渲染状态 ───────────────────────────────────────────────────
  /** 共享背景层引用 */
  private backdrop: RenderLayer | null;
  /** 当前场景 */
  private sceneA: SceneBase | null = null;
  /** 下一场景 */
  private sceneB: SceneBase | null = null;
  /** 过渡混合系数 0..1 */
  private mix = 0;
  /** 滚动速度（用于驱动色散强度等动效） */
  private velocity = 0;

  /** 当前画布尺寸信息 */
  private size = { width: 1, height: 1, pixelRatio: 1 };
  /** 蓝噪声偏移（逐帧黄金比例递增） */
  private blueOffset = new THREE.Vector2();

  constructor(opts: TransitionRendererOptions) {
    this.backdrop = opts.backdrop ?? null;
    this.renderTargetA = createRenderTarget(1, 1);
    this.renderTargetB = createRenderTarget(1, 1);

    // 初始化合成着色器材质
    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: compositeVert,
      fragmentShader: compositeFrag,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        tSceneA: { value: null },       // 场景 A 的离屏纹理
        tSceneB: { value: null },       // 场景 B 的离屏纹理
        tScroll: { value: opts.scrollTexture },  // 滚动过渡数据纹理
        tBlue: { value: opts.blueNoiseTexture }, // 蓝噪声
        uResolution: { value: new THREE.Vector2(1, 1) },
        uBlueOffset: { value: this.blueOffset.clone() },
        uMix: { value: 0 },            // 过渡混合系数
        uProgressVel: { value: 0 },     // 滚动速度
        uHomeChromaticStrength: { value: opts.chromaticStrength ?? 0.58 },
        uHomeEdgeSoftness: { value: opts.edgeSoftness ?? 1 },
        uSceneMistStrength: { value: 0 },
      },
    });

    // 全屏四边形用于合成 pass
    this.compositeQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.compositeMaterial,
    );
    this.compositeScene.add(this.compositeQuad);
  }

  /** 设置当前帧要渲染的场景对 */
  setSceneTargets(sceneA: SceneBase, sceneB: SceneBase) {
    this.sceneA = sceneA;
    this.sceneB = sceneB;
  }

  /** 设置过渡混合系数和滚动速度 */
  setMix(mix: number, velocity = 0) {
    this.mix = Math.min(1, Math.max(0, mix));
    this.velocity = Math.min(1, Math.max(0, velocity));
  }

  /** 响应画布尺寸变化，同步更新 RT 大小和 uniform */
  setSize(width: number, height: number, pixelRatio = 1) {
    this.size.width = width;
    this.size.height = height;
    this.size.pixelRatio = pixelRatio;

    // 物理像素分辨率
    const rw = Math.max(1, Math.round(width * pixelRatio));
    const rh = Math.max(1, Math.round(height * pixelRatio));
    this.renderTargetA.setSize(rw, rh);
    this.renderTargetB.setSize(rw, rh);
    this.compositeMaterial.uniforms.uResolution.value.set(rw, rh);
    this.backdrop?.setSize?.(rw, rh);
  }

  /** 设置色散强度 */
  setChromaticStrength(v: number) {
    this.compositeMaterial.uniforms.uHomeChromaticStrength.value = v;
  }

  /** 设置切割边缘柔和度 */
  setEdgeSoftness(v: number) {
    this.compositeMaterial.uniforms.uHomeEdgeSoftness.value = v;
  }

  setSceneMistStrength(v: number) {
    this.compositeMaterial.uniforms.uSceneMistStrength.value = Math.min(1, Math.max(0, v));
  }

  /**
   * 每帧更新（由 Engine 调用）
   * 更新背景层和各场景的内部状态
   */
  update(delta: number, elapsed: number) {
    this.backdrop?.update?.(delta, elapsed);
    this.sceneA?.update(delta, elapsed);

    if (this.shouldRenderSceneB()) {
      this.sceneB?.update(delta, elapsed);
    }

    // 同步场景的相机宽高比
    this.sceneA?.setSize(this.size.width, this.size.height);
    if (this.shouldRenderSceneB()) {
      this.sceneB?.setSize(this.size.width, this.size.height);
    }
  }

  /**
   * 每帧渲染（由 Engine 调用）
   *
   * 流程：
   * 1. 将场景 A 离屏渲染到 renderTargetA（先画背景再画场景）
   * 2. 如需过渡，将场景 B 离屏渲染到 renderTargetB
   * 3. 用合成着色器将两个 RT 混合输出到屏幕
   */
  render(renderer: THREE.WebGLRenderer) {
    if (!this.sceneA) return;

    // 保存渲染器状态
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // 离屏渲染场景 A
    this.renderLayerToTarget(renderer, this.sceneA, this.renderTargetA);

    // 离屏渲染场景 B（仅在过渡进行中）
    if (this.shouldRenderSceneB() && this.sceneB) {
      this.renderLayerToTarget(renderer, this.sceneB, this.renderTargetB);
      this.compositeMaterial.uniforms.tSceneB.value = this.renderTargetB.texture;
    } else {
      // 没有过渡时，tSceneB 指向 A 的纹理（避免着色器采样到旧数据）
      this.compositeMaterial.uniforms.tSceneB.value = this.renderTargetA.texture;
    }

    // 更新合成着色器的 uniform
    const u = this.compositeMaterial.uniforms;
    u.tSceneA.value = this.renderTargetA.texture;
    u.uMix.value = this.mix;
    u.uProgressVel.value = this.velocity;

    // 推进蓝噪声偏移
    this.blueOffset.set(
      (this.blueOffset.x + 0.61803398875) % 1,
      (this.blueOffset.y + 0.41421356237) % 1,
    );
    u.uBlueOffset.value.copy(this.blueOffset);

    // 输出到屏幕
    renderer.setRenderTarget(previousTarget);
    renderer.clear(true, true, true);
    renderer.render(this.compositeScene, this.compositeCamera);
    renderer.autoClear = previousAutoClear;
  }

  /** 释放所有 GPU 资源 */
  dispose() {
    this.renderTargetA.dispose();
    this.renderTargetB.dispose();
    this.compositeQuad.geometry.dispose();
    this.compositeMaterial.dispose();
    this.backdrop?.dispose?.();
  }

  /** 判断是否需要渲染场景 B（过渡进行中且 B 存在且 B≠A） */
  private shouldRenderSceneB() {
    return Boolean(this.sceneB && this.sceneB !== this.sceneA && this.mix > 0.001);
  }

  /**
   * 将一个图层离屏渲染到指定 RenderTarget
   * 先绘制共享背景，再绘制图层自身
   */
  private renderLayerToTarget(
    renderer: THREE.WebGLRenderer,
    layer: RenderLayer,
    target: THREE.WebGLRenderTarget,
  ) {
    renderer.setRenderTarget(target);
    renderer.clear(true, true, true);

    // 先画共享背景
    if (this.backdrop) {
      renderer.render(this.backdrop.scene, this.backdrop.camera);
    }

    // 再画场景图层
    renderer.render(layer.scene, layer.camera);
  }
}
