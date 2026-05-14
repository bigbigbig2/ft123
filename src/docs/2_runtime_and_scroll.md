# 2. 运行时与物理滚动 (Runtime & Scroll)

`src/runtime/ScrollController.ts` 是整个 3D 体验的“发动机”。在高端的 Web 3D 项目中，直接使用原生的 CSS `overflow: scroll` 是无法提供阻尼感、弹性吸附以及速度计算的。

## 2.1 核心状态

`ScrollController` 对外暴露的最重要的两个状态是：
- `progress` (0.0 ~ 1.0)：基于页面可滚动最大距离计算出的归一化当前进度。
- `velocity` (0.0 ~ 1.0+)：基于相邻两帧进度差值计算出的平滑速度。

## 2.2 速度的阻尼与平滑计算 (Velocity Damping)

在传统的滚动中，速度是一个极其不稳定的跳变值（比如鼠标滚轮咔哒一下，速度瞬间极大，下一帧瞬间归零）。如果直接将原生的瞬时速度传给着色器作为拉丝强度，画面会剧烈闪烁。

在 `updateVelocity` 方法中，我们运用了**指数平滑阻尼算法 (Exponential Damping)**：

```typescript
private updateVelocity(delta: number) {
  // 1. 获取本帧瞬时速度（通过进度的差值放大）
  const frameVelocity = clamp(Math.abs(this.progress - this.lastProgress) * 18 * this.velocityScale, 0, 1);
  
  // 2. 使用指数衰减函数平滑速度
  this.velocity = damp(this.velocity, frameVelocity, this.velocityDamping, delta);
  
  if (this.velocity < 0.001) this.velocity = 0;
  this.lastProgress = this.progress;
}

// damp 函数实现 (基于帧率无关的插值)
function damp(current: number, target: number, lambda: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}
```
**原理**：`lambda` (即 `velocityDamping`，通常为 10) 决定了速度跟随的“粘滞感”。这使得当用户停止滚动时，速度不会瞬间清零，而是有一个极其平滑的衰减过程，从而让着色器中的色散拖尾能“缓慢收缩”，营造出优秀的物理惯性。

## 2.3 物理弹性吸附 (Smart Snapping)

为了保证用户停止滚动时，画面始终能完美停留在某个场景的中心，避免“卡在两个场景中间”的尴尬状态，控制器实现了一套复杂的自动吸附机制 `maybeSnap`。

### 触发条件矩阵
每一次 `raf` 循环，系统会进行严苛的过滤：
1. 距离最后一次鼠标/触摸输入超过 `snapIdleDelay` (如 240ms)。
2. 当前物理速度 `velocity` 已经降到极低的阈值 `snapVelocityThreshold` (如 0.012) 以下。
3. 当前位置距离目标吸附点的距离超过 `snapDistanceThreshold` (过滤极微小的抖动)。

### 两阶段回弹动效 (Overshoot & Settle)
这是提升质感的关键。普通的滚动吸附只是线性滑过去，显得死板。`snapToProgress` 实现了极其高级的“惯性冲出再回弹”效果：

```typescript
// 1. 计算超调量 (Overshoot)
const overshootDistance = Math.min(Math.abs(distance) * this.overshootScale, limit * this.overshootMaxRatio);
const overshoot = clamp(final + Math.sign(distance) * overshootDistance, 0, limit);

// 2. 第一阶段：快速冲向“溢出点”
this.lenis.scrollTo(overshoot, {
  duration: phaseOneDuration, // 占总时长的 72%
  easing: easeOutCubic,
  onComplete: () => {
    // 3. 第二阶段：柔和回弹到最终目标
    this.lenis.scrollTo(final, {
      duration: phaseTwoDuration, // 占总时长的 28%
      easing: easeOutCubic
    });
  }
});
```
这种精妙的时间与空间切分，模拟了物理世界中受阻尼弹簧牵引的真实反馈，是所谓“苹果级手感”的底层实现。
