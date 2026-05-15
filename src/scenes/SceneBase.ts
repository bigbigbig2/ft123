import * as THREE from 'three';

export type SceneTransitionRole = 'current' | 'next';
export type SceneTransitionDirection = -1 | 0 | 1;

/**
 * 场景转场特效状态
 * 专用于向场景广播当前正在发生的全屏特效混合系数
 */
export interface SceneTransitionState {
  role: SceneTransitionRole;
  localProgress: number; // 当前段落内的相对进度
  blend: number;         // 0 -> 1 的转场融合系数，到达 1 表示转场彻底完成
  direction: SceneTransitionDirection;
  currentIndex: number;
}

/**
 * 场景内部生命周期与滚动状态（核心调度状态）
 * 将场景在整个滚动条上的时间线，精准拆分为更具物理语义的几个维度
 */
export interface SceneScrollState {
  role: SceneTransitionRole | 'inactive';
  sceneIndex: number;
  
  /** 
   * 纯地理进度 (0~1)
   * 仅仅表示用户在当前场景驻留段落内滚动的物理距离百分比，不包含转场特效的影响
   */
  local: number;
  
  /** 
   * 视觉聚焦点 / 曝光度 (0~1)
   * 代表该场景目前在屏幕上占据的主导权。
   * - 正在退场时 (current)：focus = 1.0 - blend
   * - 正在进场时 (next)：focus = blend
   */
  focus: number;
  
  /** 
   * 进场阶段进度 (0~1)
   * 专为新场景（next）准备。跟随 blend 从 0 涨到 1，用于做模型浮现、从下方滑入等预演动画
   */
  enter: number;
  
  /** 
   * 退场阶段进度 (0~1)
   * 专为老场景（current）准备。跟随 blend 从 0 涨到 1，用于做模型向上滑出、解体等销毁动画
   */
  leave: number;
  
  /** 继承自 ScrollController 的物理阻尼速度，用于驱动与速度相关的拖尾或形变 */
  velocity: number;
  direction: SceneTransitionDirection;
}

export interface SceneBase {
  readonly name: string;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;

  /** 激活或休眠该场景。休眠时将停止内部 update 循环和渲染，极致优化性能 */
  setActive(active: boolean): void;
  setProgress(progress: number): void;
  
  /** 接收 SceneStack 的转场特效广播 */
  setTransitionState(state: SceneTransitionState): void;
  
  /** 接收详细的滚动维度数据，在此钩子中编写模型视差、入场与退场动效 */
  setScrollState(state: SceneScrollState): void;
  
  update(delta: number, elapsed: number): void;
  setSize(width: number, height: number): void;
  dispose?(): void;
}
