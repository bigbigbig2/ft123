import * as THREE from 'three';

/** 场景在转场中的角色：当前主场景 或 即将切入的下一个场景 */
export type SceneTransitionRole = 'current' | 'next';
/** 转场方向：1 向下（前进）, -1 向上（后退）, 0 停止 */
export type SceneTransitionDirection = -1 | 0 | 1;

/**
 * SceneTransitionState: 基础转场状态包。
 * 兼容性较强，主要用于控制基础的显示/隐藏和简单混合。
 */
export interface SceneTransitionState {
  role: SceneTransitionRole;
  localProgress: number; // 当前场景的局部进度 (0..1)
  blend: number;         // 转场混合度 (0..1)
  direction: SceneTransitionDirection;
  currentIndex: number;  // 当前时间轴段的索引
}

/**
 * SceneScrollState: 详细滚动状态包。
 * 提供更精细的参数，常用于驱动复杂的着色器效果（如：扭曲、散开、运动模糊）。
 */
export interface SceneScrollState {
  // 角色增加了 'inactive'，表示该场景目前不在视野内
  role: SceneTransitionRole | 'inactive';
  sceneIndex: number;
  local: number;    // 场景内容进度 (0..1)
  focus: number;    // 视觉焦点权重 (0..1)，1 表示完全占据画面
  enter: number;    // 进场进度 (0..1)
  leave: number;    // 出场进度 (0..1)
  segmentProgress: number; // 当前时间轴段内部进度 (0..1)
  transitionProgress: number; // 显式转场段进度 (0..1)，非转场段为 0
  velocity: number; // 瞬时滚动速度 (0..1)
  direction: SceneTransitionDirection;
}

/**
 * SceneBase 接口：所有 3D 场景（VideoScene, EarthScene 等）必须实现此接口。
 *
 * 核心设计：
 * 它定义了渲染器如何与具体场景进行通信。
 * 通过 setProgress/setScrollState，渲染器将滚动导演计算出的逻辑状态同步给场景。
 */
export interface SceneBase {
  readonly name: string;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;

  /** 激活或停用场景。停用时，场景应停止逻辑更新并准备释放/隐藏 GPU 资源。 */
  setActive(active: boolean): void;
  /** 设置局部进度（通常用于驱动场景内的关键帧动画） */
  setProgress(progress: number): void;
  /** 设置精简版转场状态 */
  setTransitionState(state: SceneTransitionState): void;
  /** 设置详细版滚动状态（推荐用于 Shader 传参） */
  setScrollState(state: SceneScrollState): void;
  /** 每帧逻辑更新 */
  update(delta: number, elapsed: number): void;
  /** 响应尺寸变化（用于更新相机 Aspect 等） */
  setSize(width: number, height: number): void;
  /** 销毁资源 */
  dispose?(): void;
}
