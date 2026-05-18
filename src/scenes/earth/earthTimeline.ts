import type { SceneScrollState } from '../SceneBase';
import { clamp, smoothstep } from '../../scroll/math';

export interface EarthTimelineConfig {
  spinStart: number;
  spinEnd: number;
  spinTurns: number;
  nextLiftAmount: number;
  stagingStart: number;
  stagingEnd: number;
  textRevealStart: number;
  textRevealEnd: number;
}

export const DEFAULT_EARTH_TIMELINE_CONFIG: EarthTimelineConfig = {
  spinStart: 0.15,
  spinEnd: 0.52,
  spinTurns: 1,
  nextLiftAmount: 0.62,
  stagingStart: 0.52,
  stagingEnd: 0.68,
  textRevealStart: 0.56,
  textRevealEnd: 0.72,
};

/** 鍦扮悆绔犺妭鍐呴儴鍔ㄧ敾杞ㄩ亾銆傛墍鏈夊€奸兘宸茬粡褰掍竴鍖栵紝EarthScene 鍙礋璐ｅ簲鐢ㄣ€?*/
export interface EarthTimeline {
  liftProgress: number;
  pullBack: number;
  staging: number;
  textReveal: number;
  focus: number;
  scrollSpin: number;
  spinComplete: boolean;
}

export function getEarthTimeline(
  state: SceneScrollState,
  config: EarthTimelineConfig = DEFAULT_EARTH_TIMELINE_CONFIG,
): EarthTimeline {
  const isCurrent = state.role === 'current';

  // 鍏ュ満鏃剁殑鎶捣鍔ㄧ敾
  const nextLift = state.role === 'next'
    ? clamp((state.enter - 0.06) / (1 - 0.06)) * config.nextLiftAmount
    : 0;

  const liftProgress = isCurrent
    ? config.nextLiftAmount + clamp(state.local / Math.max(config.spinStart, 0.0001)) * (1 - config.nextLiftAmount)
    : nextLift;

  // 鍏抽敭锛氬皢鏃嬭浆鍜屾媺杩滃姩鐢绘敼涓虹嚎鎬э紝閰嶅悎鍏ㄥ眬闃诲凹瀹炵幇鈥滄墜闅忓績鍔ㄢ€濈殑杩炶疮鎰熴€?
  const pullBack = clamp((state.local - config.spinStart) / Math.max(config.spinEnd - config.spinStart, 0.0001));

  return {
    liftProgress,
    pullBack,
    // 鐜拰鏂囧瓧鐨勫嚭鐜颁緷鐒朵繚鐣欒交寰紦鍔紝鍥犱负瀹冧滑鏄鏁?UI 鍏冪礌锛屼笉闇€瑕佸儚鏃嬭浆閭ｆ牱杩芥眰寮虹儓鐨勭墿鐞嗚繛璐€?
    staging: smoothstep(config.stagingStart, config.stagingEnd, state.local),
    textReveal: smoothstep(config.textRevealStart, config.textRevealEnd, state.local),
    focus: clamp(state.focus),
    scrollSpin: pullBack * (Math.PI * 2 * config.spinTurns),
    spinComplete: isCurrent && state.local >= config.spinEnd,
  };
}
