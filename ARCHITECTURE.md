# FT 运行时架构说明

当前项目已经从旧的自研滚动状态机，重构为一条统一的滚动管线：

```txt
浏览器滚轮 / 触摸
  -> Lenis
  -> GSAP ScrollTrigger
  -> ScrollRig
  -> TimelineDirector
  -> SceneBase 场景实现
  -> TransitionRenderer
```

这条链路里，**全局滚动进度只有一个来源**：`ScrollRig` 输出的 `progress / velocity / direction`。场景切换、shader 混合、DOM overlay、背景动画都从这份状态继续派生，避免多个模块各自计算滚动进度。

## 核心职责

- `src/scroll/ScrollRig.ts`  
  封装 Lenis 和 GSAP ScrollTrigger，负责把浏览器滚动转换成统一的 `progress`、`velocity`、`direction`。

- `src/scroll/chapterConfig.ts`  
  章节配置入口。章节权重、转场窗口、预加载距离、滚动高度都在这里调。

- `src/scroll/TimelineDirector.ts`  
  把全局滚动进度映射成当前章节、下个章节、当前场景、下个场景、转场混合值 `mix`，并把标准化的场景状态分发给各个 `SceneBase`。

- `src/runtime/TransitionRenderer.ts`  
  负责 WebGL 合成。它只接受导演层给出的 `current / next / mix / velocity`，不再自己判断场景路由。

- `src/scenes/SceneBase.ts`  
  定义所有场景必须实现的公共接口。

- `src/scenes/earth/createEarthModel.ts`  
  创建程序化地球：纹理加载、球体、大气层、地球材质 shader 注入。

- `src/scenes/earth/earthTimeline.ts`  
  负责地球章节内部的动画进度映射，例如抬升、拉远、自转、环和文字出现。

- `src/ui/EarthOverlay.ts`  
  负责地球章节的 DOM overlay 透明度和雾化强度映射。

- `src/debug/createDebugPanel.ts`  
  基于 Tweakpane 的调试面板，用来观察滚动状态并调节章节、转场、背景和引擎参数。

## 新增场景流程

新增一个场景时，不要再写新的滚动状态机。推荐流程是：

1. 实现一个 `SceneBase` 场景。
2. 在 `src/main.ts` 里实例化并加入 `sections`。
3. 在 `src/scroll/chapterConfig.ts` 里添加章节配置。
4. 如果场景有复杂的内部滚动动画，单独建立类似 `earthTimeline.ts` 的场景本地 timeline 文件。

跨场景路由只放在 `TimelineDirector`。场景内部只消费 `SceneScrollState`，不要反向控制滚动系统。

## 调试面板

调试面板由 `src/debug/createDebugPanel.ts` 创建，使用 Tweakpane。

- 页面右上角默认显示。
- 按 `D` 键可以隐藏或显示。
- Runtime 监控做了节流刷新，避免调试 UI 每帧抢占过多时间。

当前面板支持：

- 查看全局滚动进度、速度、当前场景、下个场景、`mix`。
- 跳转到任意章节。
- 调整滚轮强度和滚轮 delta 裁剪。
- 调整章节转场窗口。
- 调整转场 shader 参数。
- 调整背景颜色、点阵、噪声、中心光。
- 暂停或恢复渲染循环。

## 当前渲染模型

`TransitionRenderer` 使用三张离屏渲染目标：

- 共享动态背景。
- 当前场景。
- 下一个场景。

最后通过 `src/shaders/composite.frag.glsl` 做全屏合成。需要注意：场景选择由 `TimelineDirector` 在渲染前完成，`TransitionRenderer` 只负责把给定的场景画出来。
