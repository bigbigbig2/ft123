# 3. 场景堆栈与生命周期 (Scene Management)

本模块解析 `src/runtime/SceneStack.ts` 和 `src/scenes/ModelScene.ts`。在多场景 3D 应用中，如何在几十个复杂几何体中共存且不爆显存，全靠本层的调度。

## 3.1 进度切片与状态同步 (`SceneStack.ts`)

`SceneStack.sync(globalProgress)` 是每一帧都会调用的核心函数，它返回四个关键数据：`current`, `next`, `localProgress`, `blend`。

### 局部进度映射
假设有 4 个场景，总进度 `0.0~1.0` 会被放大 3 倍（`segments = 3`）：
```typescript
const scaled = clamped * segments;           // 例如 1.2
const currentIndex = Math.floor(scaled);     // 当前主场景索引：1
const localProgress = scaled - currentIndex; // 当前段内进度：0.2
```

### 延迟阈值计算 (`blend`)
为了给用户足够的驻留浏览时间，我们不能一滚动就开始视觉转场。通过 `transitionStart`（默认 0.66）：
```typescript
private getBlend(localProgress: number) {
  if (localProgress < this.transitionStart) return 0;
  return (localProgress - this.transitionStart) / (1 - this.transitionStart);
}
```
当 `localProgress` 从 0.66 滑到 1.0 时，`blend` 才会从 0 飙升到 1。这个 `blend` 就是驱动所有特效（无论 Shader 还是模型位移）的唯一变量。

## 3.2 极致性能优化：按需剔除 (Active Culling)

如果在后台更新 4 个场景的所有动画和矩阵计算，哪怕不渲染也会耗尽 CPU。`syncActiveScenes` 实现了严格的生命周期管理：

```typescript
// 判断下一场景是否进入了预加载裕量 (preloadMargin)
const shouldPreloadNext = localProgress >= this.transitionStart - this.preloadMargin;
const nextActiveSet = new Set<SceneBase>([current]);

if (next !== current && (blend > 0 || shouldPreloadNext)) {
  nextActiveSet.add(next);
}

// 停用不再需要的旧场景
for (const scene of this.lastActiveSet) {
  if (!nextActiveSet.has(scene)) scene.setActive(false);
}
```
这保证了在绝大多数静止浏览时间里，整个 WebGL 引擎只有 1 个场景处于活跃状态（渲染与逻辑更新）。

## 3.3 场景内 3D 视差联动 (`ModelScene.ts`)

虽然 `TransitionRenderer` 负责了整个画面的全局特效，但如果我们仅仅让背景发生变化，而中心的 3D 模型毫无空间位移，转场会显得扁平化。

我们在所有 3D 模型场景的基类 `ModelScene` 中，挂载了接收 `SceneStack` 广播的钩子：

```typescript
setTransitionState(state: SceneTransitionState) {
  this.transitionState = state;
  const distance = 4.5; // Y轴最大滑移距离
  
  if (state.role === 'current') {
    // 作为当前场景正在退场：随着 blend(0->1) 增加，模型沿 Y轴 向上滑动退出屏幕
    this.scene.position.y = state.blend * distance;
  } else {
    // 作为下一场景正在入场：随着 blend(0->1) 增加，模型从 Y轴 下方向中心滑动
    this.scene.position.y = (1.0 - state.blend) * -distance;
  }
}
```
**实现原理：**
这里巧妙地利用了 `THREE.Scene.position` 而不是移动 `Camera`。这样保证了相机视野和背景永远对齐，而内部的世界坐标随着转场同步发生位移。这让整个转场具有了非常通透的“物理上下穿梭”错觉。
