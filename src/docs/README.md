# 凡拓数创 (FT) 3D 引擎文档系统

欢迎查阅 FT 3D WebGL 引擎的开发文档。本引擎旨在为高端企业级官网提供极致流畅、且具备影视级视觉特效的 3D 滚动转场体验。

## 文档目录

建议按照以下顺序阅读文档，以建立对整个系统架构的完整认知：

1. **[架构总览 (Architecture Overview)](./1_architecture_overview.md)**
   - 了解项目的宏观设计、核心模块划分以及整体数据流转图。
   
2. **[运行时与物理滚动 (Runtime & Scroll)](./2_runtime_and_scroll.md)**
   - 探究如何将生硬的原生滚动转换为带有物理阻尼、动量和回弹吸附（Snap）效果的平滑进度数据。
   
3. **[场景堆栈与生命周期 (Scene Management)](./3_scene_management.md)**
   - 学习引擎是如何切分滚动进度、计算转场阈值，并通过按需剔除（Culling）机制保证 60FPS 的极致性能。
   - 了解基础场景类（`SceneBase` / `ModelScene`）以及 3D 视差联动的实现。

4. **[渲染管线与特效着色器 (Rendering & Shaders)](./4_rendering_and_shaders.md)**
   - 深入核心黑魔法：双缓冲离屏渲染（Dual Render Targets）。
   - 详细剖析 `composite.frag.glsl` 中的影视级过渡算法（连续色散采样、消除黑边、动态云雾掩护）。

## 核心设计理念

- **极度平滑**：所有的状态变化（如速度、转场进度）都经过数学缓动（Easing/Damping）处理。
- **解耦设计**：逻辑驱动层（Scroll / Stack）、场景内容层（Scenes）与渲染表现层（Renderer / Shader）相互独立。
- **性能优先**：严格的视椎体外剔除与活跃场景管理，确保无论添加多少场景，同时处理的 Draw Call 始终处于可控范围。
