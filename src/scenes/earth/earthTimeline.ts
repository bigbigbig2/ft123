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
  
  // 入场时的抬起动画
  const nextLift = state.role === 'next'
    ? clamp((state.enter - 0.06) / (1 - 0.06)) * NEXT_LIFT_AMOUNT
    : 0;
  
  const liftProgress = isCurrent
    ? NEXT_LIFT_AMOUNT + clamp(state.local / SCROLL_SPIN_START) * (1 - NEXT_LIFT_AMOUNT)
    : nextLift;

  // 关键：将旋转和拉远动画改为线性，配合全局阻尼实现“手随心动”的连贯感
  const pullBack = clamp((state.local - SCROLL_SPIN_START) / (SCROLL_SPIN_END - SCROLL_SPIN_START));

  return {
    liftProgress,
    pullBack,
    // 环和文字的出现依然保留轻微缓动，因为它们是离散 UI 元素，不需要像旋转那样追求强烈的物理连贯性
    staging: smoothstep(0.52, 0.68, state.local),
    textReveal: smoothstep(0.56, 0.72, state.local),
    focus: clamp(state.focus),
    scrollSpin: pullBack * SCROLL_SPIN_TURNS,
    spinComplete: isCurrent && state.local >= SCROLL_SPIN_END,
  };
}
