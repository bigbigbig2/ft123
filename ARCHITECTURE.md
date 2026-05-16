# FT 运行时架构说明

当前项目的滚动交互已经改为显式时间轴模型：**场景段负责内容进度，转场段负责 A -> B 混合**。

```txt
浏览器滚轮 / 触摸
  -> Lenis
  -> GSAP ScrollTrigger
  -> ScrollRig
  -> TimelineDirector
  -> SceneBase 场景实现
  -> TransitionRenderer
```

全局滚动进度仍然只有一个来源：`ScrollRig` 输出的 `progress / velocity / direction`。后续所有场景、转场、DOM overlay 和 shader 参数都从这份状态派生。

## 核心职责

- `src/scroll/ScrollRig.ts`  
  封装 Lenis 和 ScrollTrigger，把真实滚动转换成统一的 `0..1` 全局进度。

- `src/scroll/timelineConfig.ts`  
  显式时间轴配置入口。`scene` 段配置场景停留长度，`transition` 段配置两个场景之间的转场滚动长度。

- `src/scroll/TimelineDirector.ts`  
  根据当前全局进度找到当前时间轴段，并输出 `current / next / mix / segmentProgress / sceneProgress / transitionProgress`。

- `src/runtime/TransitionRenderer.ts`  
  负责 WebGL 离屏渲染和最终合成。它只消费导演层给出的场景对和 `mix`，不负责判断路由。

- `src/scenes/SceneBase.ts`  
  定义场景公共接口。场景只消费 `SceneScrollState`，不要反向控制滚动系统。

- `src/scenes/earth/earthTimeline.ts`  
  地球场景自己的内部动画映射，例如抬升、拉远、自转、环和文字出现。

- `src/ui/EarthOverlay.ts`  
  根据地球场景状态更新 DOM overlay 和雾化强度。

- `src/debug/createDebugPanel.ts`  
  Tweakpane 调试面板，用来观察当前段、场景进度、转场进度、滚轮输入和 shader 参数。

## 时间轴模型

时间轴配置类似这样：

```ts
[
  { type: 'scene', sceneName: 'intro-video', duration: 0.78 },
  { type: 'transition', from: 'intro-video', to: 'earth', duration: 0.34 },
  { type: 'scene', sceneName: 'earth', duration: 1.18 },
]
```

`duration` 是相对滚动长度。值越大，这一段获得的真实滚动距离越长。

这种结构把几个概念分开：

- `segmentProgress`：当前时间轴段进度。
- `sceneProgress`：场景自己的内容进度，只在 `scene` 段推进。
- `transitionProgress` / `mix`：两个场景之间的转场进度，只在 `transition` 段推进。

## 新增场景流程

1. 实现一个 `SceneBase` 场景。
2. 在 `src/main.ts` 里实例化并加入 `sections`。
3. 在 `src/scroll/timelineConfig.ts` 里添加一个 `scene` 段。
4. 如果需要和前后场景转场，在相邻位置添加 `transition` 段。
5. 如果场景内部动画复杂，单独建立类似 `earthTimeline.ts` 的场景本地 timeline 文件。

## 调试面板

浏览器中按 `D` 可以切换调试面板。当前面板支持：

- 查看当前段类型、当前段、段进度、场景进度、转场进度。
- 跳转到任意场景段起点。
- 查看完整时间轴结构。
- 调整滚轮倍率和单次滚轮上限。
- 调整转场 shader、背景和渲染循环参数。
