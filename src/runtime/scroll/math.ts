export function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function damp(current: number, target: number, lambda: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

export function easeOutExpo(value: number) {
  return Math.min(1, 1.001 - Math.pow(2, -10 * value));
}

export function smoothstep(edge0: number, edge1: number, value: number) {
  const x = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001));
  return x * x * (3 - 2 * x);
}
