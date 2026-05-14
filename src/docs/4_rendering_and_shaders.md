# 4. 渲染管线与特效着色器 (Rendering & Shaders)

本模块深入解析 `src/runtime/TransitionRenderer.ts` 的多通道离屏合成管线，以及全站最硬核的特效源码 `src/shaders/composite.frag.glsl`。

## 4.1 双离屏渲染管线 (Dual Render Targets)

要实现场景 A 和场景 B 在同一个屏幕上产生光学交融，必须借助于**离屏渲染 (Offscreen Rendering)**。`TransitionRenderer` 的 `render` 方法定义了这个三步走管线：

```typescript
render(renderer: THREE.WebGLRenderer) {
  // 【Pass 1: 渲染场景 A】
  // 设置渲染目标为 renderTargetA
  renderer.setRenderTarget(this.renderTargetA);
  renderer.clear();
  this.backdrop?.render(renderer); // 先画统一背景
  if (this.sceneA) renderer.render(this.sceneA.scene, this.sceneA.camera); // 叠加 A 模型

  // 【Pass 2: 渲染场景 B】
  renderer.setRenderTarget(this.renderTargetB);
  renderer.clear();
  this.backdrop?.render(renderer); 
  if (this.sceneB) renderer.render(this.sceneB.scene, this.sceneB.camera); // 叠加 B 模型

  // 【Pass 3: 最终屏幕合成】
  // 将目标切回 null (即真实的 Canvas 屏幕)
  renderer.setRenderTarget(null);
  
  // 将刚才拍下的 A、B 纹理传入 Shader
  this.compositeMaterial.uniforms.tSceneA.value = this.renderTargetA.texture;
  this.compositeMaterial.uniforms.tSceneB.value = this.renderTargetB.texture;
  
  // 渲染挂载着 compositeMaterial 的全屏面片
  renderer.render(this.compositeScene, this.camera);
}
```

## 4.2 着色器视觉特效剖析 (`composite.frag.glsl`)

在合成阶段，片元着色器接收 `uMix` (0~1的混合系数) 和 `uProgressVel` (物理滚动速度)，执行极高计算密度的像素重组。

### 4.2.1 非线性时间轴控制 (`peak`)
我们不使用线性的 `uMix` 控制透明度，而是提取了一座“高潮山峰”：
```glsl
float progress = smoothstep(0.0, 1.0, uMix); 
float peak = sin(progress * PI); 
```
`peak` 在转场进行到 50% 时达到 `1.0`。所有的破坏性特效（拖尾拉长、亮度爆闪、云雾遮挡）都会乘以这个 `peak`，确保转场在中央时最狂暴，在两端极度柔和。

### 4.2.2 高质量连续抽丝采样 (`sampleChromaticSmear`)
对于退场场景 A，我们实现了影视级的连续色差拖尾（Chromatic Smear）：
```glsl
vec4 sampleChromaticSmear(sampler2D source, vec2 uv, vec2 direction, float amount, float chroma) {
  vec3 accumRGB = vec3(0.0); float accumAlpha = 0.0;
  vec3 weightSum = vec3(0.0); float alphaWeightSum = 0.0;
  
  const int SAMPLES = 30; // 30次高频采样消除离散重影
  float dither = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453); // 引入空间白噪声
  
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + dither) / float(SAMPLES);
    // 指数型间距：头部密集，尾部拉长
    float curveT = t * t * (3.0 - 2.0 * t); 
    vec2 offsetUv = uv - direction * (amount * curveT);
    vec4 samp = sampleSafe(source, offsetUv);
    
    // 生成彩虹色权重：t=0偏红，t=0.5偏绿，t=1偏蓝
    float r = smoothstep(0.8, 0.0, t);
    float g = smoothstep(1.0, 0.0, abs(t - 0.4) * 2.0);
    float b = smoothstep(0.8, 0.0, 1.0 - t);
    
    // 轨迹透明度衰减
    float fade = exp(-t * 2.5);
    vec3 tint = mix(vec3(1.0), vec3(r, g, b), saturate(chroma)) * fade;
    
    // 【核心解法】预乘 Alpha：必须乘以 samp.a，避免透明背景把边缘染黑
    accumRGB += samp.rgb * samp.a * tint; 
    weightSum += samp.a * tint;
    accumAlpha += samp.a * fade;
    alphaWeightSum += fade;
  }
  
  return vec4(accumRGB / max(weightSum, 0.0001), saturate(accumAlpha / max(alphaWeightSum, 0.0001)));
}
```
**技术亮点：**
- **消除重影**：30 次连续积分配合 `dither`（抖动），视觉系统会把微小的噪点脑补成丝滑的光束，杜绝了低频采样造成的“分身”瑕疵。
- **消除黑边**：如果不乘以 `samp.a`，背景透明像素 `(rgb=0, a=0)` 的黑色会被累计进 `accumRGB`，导致模型拖尾有一圈难看的黑晕。预乘 Alpha 完美解决了这个问题，让拖尾像发光体一样纯净。

### 4.2.3 动态云雾生成 (`transitionFogMask`)
两个完全不同的 3D 模型交叠时，穿帮是不可避免的。
我们在着色器末尾，通过纯数学函数（基于 `vUv` 和 `peak`）计算出了一层动态的渐变雾罩：
```glsl
float transitionFogMask(float progress, float peak) {
  // 生成边缘浓厚、中央随着 peak 泛白的大气遮罩
  vec2 centered = (vUv - vec2(0.52, 0.48)) * vec2(1.0, 1.18);
  float centerWash = 1.0 - smoothstep(0.05, 0.92, length(centered));
  float bottomMist = smoothstep(0.44, 0.02, vUv.y);
  // ...
  return saturate(centerWash * (0.18 + peak * 0.42) + bottomMist * 0.34 + ...);
}
```
在主函数中，用这层雾罩将画面与天空蓝 `vec3(0.80, 0.87, 0.94)` 混合，这相当于在两个场景交接时，屏幕上涌现了一阵极其柔和的实体云雾，不仅遮挡了重叠瑕疵，更增强了宏大叙事的呼吸感。
