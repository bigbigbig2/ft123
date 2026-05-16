# FT 运行时说明

当前运行时围绕一个核心原则组织：**滚动进度只有一个事实来源**。

```txt
Lenis 输入
  -> GSAP ScrollTrigger
  -> ScrollRig
  -> TimelineDirector
  -> scenes + TransitionRenderer + DOM overlays
```

## 关键文件

- `src/scroll/ScrollRig.ts`：Lenis + ScrollTrigger 的统一封装。
- `src/scroll/chapterConfig.ts`：章节、权重、转场窗口和吸附点配置。
- `src/scroll/TimelineDirector.ts`：把全局滚动进度转换成当前场景、下个场景、混合值和场景状态。
- `src/runtime/TransitionRenderer.ts`：渲染背景、场景 A、场景 B，并执行最终 shader 合成。
- `src/scenes/SceneBase.ts`：场景公共接口。
- `src/scenes/earth/createEarthModel.ts`：地球模型、纹理、大气层和材质 shader 注入。
- `src/scenes/earth/earthTimeline.ts`：地球章节内部动画映射。
- `src/debug/createDebugPanel.ts`：Tweakpane 调试面板。

## 扩展规则

添加新场景时，不需要修改滚动系统：

1. 新建一个实现 `SceneBase` 的场景。
2. 在 `src/main.ts` 注册到 `sections`。
3. 在 `src/scroll/chapterConfig.ts` 增加章节配置。

场景自己的动画可以放在场景模块或场景本地 timeline 文件中。跨场景路由只放在 `TimelineDirector`。

## 调试

浏览器中按 `D` 可以切换 Tweakpane 调试面板。面板可查看滚动状态、跳转章节，并调节章节转场、shader 和背景参数。
