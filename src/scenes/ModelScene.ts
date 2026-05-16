/**
 * ModelScene.ts — 通用 3D 模型场景
 *
 * 提供一个带默认灯光、透视相机和自动旋转功能的 3D 场景容器。
 * 用于展示 GLTF 模型（如地球场景）或简单的几何体（如占位场景）。
 */
import * as THREE from 'three';
import type { SceneBase, SceneScrollState, SceneTransitionState } from './SceneBase';

/** ModelScene 构造选项 */
export interface ModelSceneOptions {
  name: string;                           // 场景名称
  model?: THREE.Object3D;                 // 初始模型（可选，也可后续用 addModel 添加）
  fov?: number;                           // 相机视角（默认 40°）
  cameraPosition?: THREE.Vector3Tuple;    // 相机位置 [x, y, z]
  cameraLookAt?: THREE.Vector3Tuple;      // 相机注视点 [x, y, z]
  autoRotate?: boolean;                   // 是否自动旋转（默认 true）
  autoRotateSpeed?: number;               // 自动旋转速度（弧度/秒，默认 0.2）
}

/**
 * ModelScene — 3D 模型展示场景
 *
 * 实现 SceneBase 接口，可被 TimelineDirector 管理。
 * 内置环境光、半球光、主光源和补光灯，
 * 提供 attachAndFit() 方法自动缩放和居中模型。
 */
export class ModelScene implements SceneBase {
  readonly name: string;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** 模型根节点，自动旋转作用于此 Group */
  readonly modelRoot = new THREE.Group();

  /** 是否启用自动旋转 */
  private autoRotate: boolean;
  /** 自动旋转速度 */
  private autoRotateSpeed: number;
  /** 场景是否处于激活状态 */
  private active = false;
  /** 当前过渡状态 */
  private transitionState: SceneTransitionState | null = null;
  protected scrollState: SceneScrollState | null = null;

  constructor(opts: ModelSceneOptions) {
    this.name = opts.name;
    this.autoRotate = opts.autoRotate ?? true;
    this.autoRotateSpeed = opts.autoRotateSpeed ?? 0.2;

    // 背景设为 null（透明），由 SharedBackdrop 统一绘制底色
    this.scene.background = null;

    // ── 透视相机 ─────────────────────────────────────────────────
    const fov = opts.fov ?? 40;
    this.camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 100);
    const pos = opts.cameraPosition ?? [0, 1.2, 4];
    const look = opts.cameraLookAt ?? [0, 0, 0];
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.camera.lookAt(look[0], look[1], look[2]);

    // ── 灯光设置 ─────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffffff, 1.45);       // 环境光
    const hemi = new THREE.HemisphereLight(0xeaf3ff, 0x9aa6b8, 1.15); // 半球光（天 / 地）
    const key = new THREE.DirectionalLight(0xffffff, 2.25);       // 主光源
    key.position.set(3.5, 5, 4);
    const fill = new THREE.DirectionalLight(0xbfd8ff, 1.35);      // 补光灯（偏蓝冷调）
    fill.position.set(-4, 2.5, 3);
    this.scene.add(ambient);
    this.scene.add(hemi);
    this.scene.add(key);
    this.scene.add(fill);

    // 将模型根节点加入场景
    this.scene.add(this.modelRoot);
    if (opts.model) this.modelRoot.add(opts.model);
  }

  /** 设置场景激活状态 */
  setActive(active: boolean) {
    this.active = active;
  }

  /** 设置段内局部进度（当前未使用，预留扩展） */
  setProgress(_progress: number) {
  }

  /** 接收过渡状态信息 */
  setTransitionState(state: SceneTransitionState) {
    this.transitionState = state;
  }

  setScrollState(state: SceneScrollState) {
    this.scrollState = state;
  }

  setAutoRotate(enabled: boolean) {
    this.autoRotate = enabled;
  }

  getAutoRotate() {
    return this.autoRotate;
  }

  setAutoRotateSpeed(speed: number) {
    this.autoRotateSpeed = speed;
  }

  getAutoRotateSpeed() {
    return this.autoRotateSpeed;
  }

  setCameraFov(fov: number) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 每帧更新
   * 当场景激活时执行自动旋转；
   * 如果场景角色为 'next'（即将进入），则降低旋转速度
   */
  update(delta: number, _elapsed: number) {
    if (!this.active) return;

    if (this.autoRotate) {
      // 作为 "next" 角色时旋转速度降至 55%，避免视觉突兀
      const roleBoost = this.transitionState?.role === 'next' ? 0.55 : 1;
      this.modelRoot.rotation.y += delta * this.autoRotateSpeed * roleBoost;
    }
  }

  /** 响应画布尺寸变化，更新相机宽高比 */
  setSize(width: number, height: number) {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  /** 替换模型（先清空再添加） */
  addModel(model: THREE.Object3D) {
    this.modelRoot.clear();
    this.modelRoot.add(model);
  }

  /**
   * 添加模型并自动缩放居中
   *
   * 计算模型的包围盒，将其缩放到 desiredSize 大小，
   * 并将模型中心移至原点。
   *
   * @param model - 要添加的模型
   * @param desiredSize - 目标尺寸（最大维度，默认 2）
   */
  attachAndFit(model: THREE.Object3D, desiredSize = 2) {
    this.addModel(model);

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = desiredSize / maxDim;
    model.scale.setScalar(scale);
    // 将模型中心偏移到原点
    model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  }

  /** 释放场景中所有网格的几何体和材质 */
  dispose() {
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      }
    });
  }
}
