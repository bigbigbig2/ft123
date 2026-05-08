/**
 * SceneBase.ts — 场景基础接口
 *
 * 定义了所有场景必须实现的统一接口，
 * 使 SceneStack 和 TransitionRenderer 能以多态方式管理不同类型的场景。
 */
import * as THREE from 'three';

/** 场景在过渡中扮演的角色 */
export type SceneTransitionRole = 'current' | 'next';

/** 滚动方向：-1 向上/向前，0 静止，1 向下/向后 */
export type SceneTransitionDirection = -1 | 0 | 1;

/** 过渡状态描述，由 SceneStack 在每帧计算并传递给场景 */
export interface SceneTransitionState {
  role: SceneTransitionRole;               // 当前角色（主场景 or 下一场景）
  localProgress: number;                   // 段内局部进度 0..1
  blend: number;                           // 过渡混合系数 0..1
  direction: SceneTransitionDirection;     // 滚动方向
  currentIndex: number;                    // 当前段索引
}

/**
 * SceneBase — 场景基础接口
 *
 * 所有可被 SceneStack 管理的场景都必须实现此接口。
 * 包括 VideoScene、ModelScene 等。
 */
export interface SceneBase {
  /** 场景名称（用于调试） */
  readonly name: string;
  /** Three.js 场景对象 */
  readonly scene: THREE.Scene;
  /** 场景使用的相机 */
  readonly camera: THREE.Camera;

  /** 设置场景是否处于激活状态（控制更新和资源） */
  setActive(active: boolean): void;
  /** 设置段内局部进度 */
  setProgress(progress: number): void;
  /** 设置过渡状态 */
  setTransitionState(state: SceneTransitionState): void;
  /** 每帧更新 */
  update(delta: number, elapsed: number): void;
  /** 响应画布尺寸变化 */
  setSize(width: number, height: number): void;
  /** 释放资源（可选） */
  dispose?(): void;
}
