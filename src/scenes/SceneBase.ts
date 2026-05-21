import * as THREE from 'three';

export type SceneTransitionRole = 'current' | 'next';
export type SceneTransitionDirection = -1 | 0 | 1;

export interface SceneTransitionState {
  role: SceneTransitionRole;
  localProgress: number;
  blend: number;
  direction: SceneTransitionDirection;
  currentIndex: number;
}

export interface SceneScrollState {
  role: SceneTransitionRole | 'inactive';
  sceneIndex: number;
  local: number;
  focus: number;
  enter: number;
  leave: number;
  segmentProgress: number;
  transitionProgress: number;
  velocity: number;
  direction: SceneTransitionDirection;
}

export interface SceneBase {
  readonly name: string;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;

  setActive(active: boolean): void;
  setProgress(progress: number): void;
  setTransitionState(state: SceneTransitionState): void;
  setScrollState(state: SceneScrollState): void;
  update(delta: number, elapsed: number): void;
  setSize(width: number, height: number): void;
  dispose?(): void;
}

export interface SceneBloomEffect {
  enabled: boolean;
  /** Object/camera layer used for selective bloom rendering. */
  layer: number;
  strength?: number;
  radius?: number;
  tint?: THREE.ColorRepresentation;
  resolutionScale?: number;
}

export interface ScenePostEffects {
  bloom?: SceneBloomEffect | SceneBloomEffect[];
}

export interface PostProcessableScene extends SceneBase {
  getPostEffects(): ScenePostEffects;
}
