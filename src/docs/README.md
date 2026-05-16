# FT 运行时说明

当前运行时围绕一个原则组织：**滚动进度只有一个事实来源，时间轴段负责解释这份进度**。

```txt
Lenis 输入
  -> GSAP ScrollTrigger
  -> ScrollRig
  -> TimelineDirector
  -> scenes + TransitionRenderer + DOM overlays
```

## 关键文件

- `src/scroll/ScrollRig.ts`：Lenis + ScrollTrigger 的统一封装。
- `src/scroll/timelineConfig.ts`：显式时间轴配置，包含 `scene` 段和 `transition` 段。
- `src/scroll/TimelineDirector.ts`：把全局滚动进度转换成当前段、场景对、混合值和场景状态。
- `src/runtime/TransitionRenderer.ts`：渲染背景、场景 A、场景 B，并执行最终 shader 合成。
- `src/scenes/SceneBase.ts`：场景公共接口。
- `src/scenes/earth/earthTimeline.ts`：地球场景内部动画映射。
- `src/debug/createDebugPanel.ts`：Tweakpane 调试面板。

## 时间轴规则

`scene` 段只推进场景自己的内容进度：

```ts
{ type: 'scene', sceneName: 'earth', duration: 1.18 }
```

`transition` 段只推进两个场景之间的混合：

```ts
{ type: 'transition', from: 'intro-video', to: 'earth', duration: 0.34 }
```

这样可以单独配置“某个场景停留多久”和“A -> B 转场滚多久”，不会再把转场塞进上一个场景的内部进度里。

## 扩展规则

添加新场景时：

1. 新建一个实现 `SceneBase` 的场景。
2. 在 `src/main.ts` 注册到 `sections`。
3. 在 `src/scroll/timelineConfig.ts` 增加 `scene` 段。
4. 根据需要增加前后 `transition` 段。

场景自己的动画放在场景模块或场景本地 timeline 文件中。跨场景路由只放在 `TimelineDirector`。

## 调试

浏览器中按 `D` 可以切换 Tweakpane 调试面板。面板可查看当前段、段进度、场景进度、转场进度，并调节滚轮、shader 和背景参数。
