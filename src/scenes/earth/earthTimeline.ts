import type { SceneScrollState } from '../SceneBase';
import { clamp, smoothstep } from '../../scroll/math';

const SCROLL_SPIN_START = 0.15;
const SCROLL_SPIN_END = 0.52;
const SCROLL_SPIN_TURNS = Math.PI * 2;
const NEXT_LIFT_AMOUNT = 0.62;

/** 地球章节内部动画轨道。所有值都已经归一化，EarthScene 只负责应用。 */
export interface EarthTimeline {
  liftProgress: number;
  pullBack: number;
  staging: number;
  textReveal: number;
  focus: number;
  scrollSpin: number;
  spinComplete: boolean;
}

export function getEarthTimeline(state: SceneScrollState): EarthTimeline {
  const isCurrent = state.role === 'current';
  // 作为 next 进入显式转场段时，地球先完成较明显的预入场，避免 A -> B 转场中只剩背景。
  const nextLift = state.role === 'next'
    ? smoothstep(0.06, 1, state.enter) * NEXT_LIFT_AMOUNT
    : 0;
  const liftProgress = isCurrent
    ? NEXT_LIFT_AMOUNT + smoothstep(0, 1, clamp(state.local / SCROLL_SPIN_START)) * (1 - NEXT_LIFT_AMOUNT)
    : nextLift;
  const pullBack = smoothstep(SCROLL_SPIN_START, SCROLL_SPIN_END, state.local);

  return {
    liftProgress,
    pullBack,
    // 环和文字比主体动画晚出现，避免信息在入场阶段抢视觉焦点。
    staging: smoothstep(0.52, 0.68, state.local),
    textReveal: smoothstep(0.56, 0.72, state.local),
    focus: clamp(state.focus),
    scrollSpin: smoothstep(SCROLL_SPIN_START, SCROLL_SPIN_END, state.local) * SCROLL_SPIN_TURNS,
    spinComplete: isCurrent && state.local >= SCROLL_SPIN_END,
  };
}
