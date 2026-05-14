# 1. 架构总览 (Architecture Overview)

本引擎采用了一套**高度解耦**、**单向数据流**的 3D 渲染架构。为了保证即使在堆叠了大量高精度模型的情况下依然能保持 60FPS，系统严格分离了“物理输入”、“逻辑状态”、“渲染分发”与“视觉特效”。

## 1.1 核心组件与初始化管线

在应用的入口 `src/main.ts` 的 `bootstrap()` 函数中，定义了整个系统的组装顺序。这个顺序展示了架构的层级关系：

1. **引擎核心 (`Engine.ts`)**
   ```typescript
   const engine = new Engine(container);
   ```
   `Engine` 是最低层的基石，它内部包裹了 `THREE.WebGLRenderer` 和 `requestAnimationFrame` 循环。它不关心业务逻辑，只负责驱动被挂载的视图（`EngineView`）并派发 `Tick` 事件。

2. **运行时环境与状态机 (`ScrollController`, `SceneStack`)**
   ```typescript
   const scroll = new ScrollController({ sectionCount: sections.length, snap: true });
   const stack = new SceneStack(sections, { transitionStart: 0.66 });
   ```
   它们是逻辑层的核心。`ScrollController` 将用户生硬的物理滚轮事件转化为丝滑的 `progress` (0~1)。`SceneStack` 则根据这个全局进度，计算出当前应该激活哪两个场景（A 和 B），以及它们的混合系数 `blend`。

3. **渲染管线与视图 (`TransitionRenderer`, `SharedBackdrop`)**
   ```typescript
   const backdrop = new SharedBackdrop({ perlinTexture, dotPatternTexture, blueNoiseTexture });
   const transition = new TransitionRenderer({ scrollTexture, blueNoiseTexture, backdrop });
   engine.setView(transition);
   ```
   `TransitionRenderer` 实现了 `EngineView` 接口，成为了引擎的“主摄像头”。它接管了最终的画面输出权，利用两个离屏缓冲区（FBO）分别渲染场景 A 和场景 B。

## 1.2 主循环数据流向 (Game Loop Data Flow)

在 `main.ts` 中注册的每帧回调，清晰地展示了数据是如何自上而下流动的：

```typescript
engine.onTick((_delta, _elapsed, time) => {
  // 1. 物理层：驱动 Lenis 平滑滚动，计算当前进度与速度
  scroll.raf(time);
  
  // 2. 状态层：同步进度给背景，让背景产生位移
  backdrop.setProgress(scroll.progress);

  // 3. 逻辑层：询问 SceneStack 当前的转场状态
  const { current, next, blend } = stack.sync(scroll.progress);
  
  // 4. 渲染层：将目标场景和混合参数派发给管线
  transition.setSceneTargets(current, next);
  transition.setMix(blend, scroll.velocity);
});
```

**数据流向总结**：
`Mouse Wheel` ➔ `ScrollController (Velocity & Progress)` ➔ `SceneStack (Scene A, Scene B, Blend)` ➔ `Scenes (Parallax Y)` ➔ `TransitionRenderer (Offscreen FBOs)` ➔ `Shader (Final Composite)`

---

## 1.3 核心设计模式

- **接口多态 (Polymorphism)**：所有场景（如 `EarthScene`, `VideoScene`）都实现了 `SceneBase` 接口，这使得 `SceneStack` 和 `TransitionRenderer` 可以无视具体场景类型进行调度。
- **职责单一 (SRP)**：场景内部（`ModelScene.ts`）只负责模型加载、自身动画和根据 `blend` 计算 Y 轴视差位移；它完全不知道转场特效是如何渲染的，这使得维护和新增场景极其简单。
