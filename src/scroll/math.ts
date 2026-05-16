/**
 * 数值裁剪函数：将 value 限制在 [min, max] 范围内。
 */
export function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

/** 
 * 指数阻尼插值 (Exponential Damp)：
 * 适合做帧率无关的平滑追赶（Lerp 的进阶版）。
 * @param current 当前值
 * @param target 目标值
 * @param lambda 阻尼系数（值越大追赶越快）
 * @param delta 帧间隔时间 (dt)
 */
export function damp(current: number, target: number, lambda: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

/** 
 * 指数缓动收尾 (Ease Out Expo)：
 * 常用于滚动动画，产生那种从快到慢、最后轻轻停下的高级感。
 */
export function easeOutExpo(value: number) {
  return Math.min(1, 1.001 - Math.pow(2, -10 * value));
}

/** 
 * GLSL 风格的平滑阶梯函数 (Smoothstep)：
 * 将线性进度映射为 S 型曲线，使 0 和 1 处的过渡非常柔和。
 * 公式：3x^2 - 2x^3
 */
export function smoothstep(edge0: number, edge1: number, value: number) {
  // 先将 value 归一化到 [0, 1]
  const x = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001));
  // 应用三次插值多项式
  return x * x * (3 - 2 * x);
}
