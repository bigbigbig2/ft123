/**
 * SharedBackdrop.ts — 共享动态背景层
 *
 * 核心逻辑：
 * 在所有业务场景的最底层渲染一个全屏背景。
 * 它不是简单的静态色块，而是通过：
 * 1. 柏林噪声 (Perlin Noise) 动态生成的渐变底色。
 * 2. 点阵 (Dot Pattern) 叠加，随滚动产生视差位移。
 * 3. 蓝噪声 (Blue Noise) 抖动，彻底消除 WebGL 在 8位色彩下的色阶断层 (Banding)。
 */
import * as THREE from 'three';

// ── 背景顶点着色器（全屏三角形直通） ─────────────────────────────
const CUBES_BG_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // 使用裁剪空间坐标 (NDC) 直接输出，覆盖整个视口
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// ── 背景片元着色器 ───────────────────────────────────────────────
const CUBES_BG_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;

  uniform float uTime;          // 累计时间（秒）
  uniform float uProgress;      // 全局滚动进度 0..1
  uniform float uAspect;        // 画布宽高比
  uniform vec2 uResolution;     // 画布分辨率（像素）
  uniform vec3 uColor1;         // 渐变底色 1
  uniform vec3 uColor2;         // 渐变底色 2
  uniform sampler2D tPerlin;    // 柏林噪声纹理（预计算的）
  uniform sampler2D tDotPattern;// 点阵遮罩纹理
  uniform sampler2D tBlue;      // 蓝噪声纹理
  uniform vec2 uBlueOffset;    // 蓝噪声逐帧偏移（用于抗闪烁和抖动）
  uniform float uDotStrength;  // 点阵显示强度
  uniform float uBlueNoiseStrength;
  uniform float uCenterGlowStrength;

  // 简易二维哈希：给每个点阵格子生成一个唯一的随机 ID，用于闪烁动画
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // 采样蓝噪声纹理（128×128 循环平铺）
  vec4 getBlueNoise(vec2 fragCoord) {
    float invSize = 1.0 / 128.0;
    return texture2D(tBlue, fragCoord * invSize + uBlueOffset);
  }

  // 软采样柏林噪声：通过 4 次轻微偏移采样取均值，消除噪点的生硬感，使渐变更丝滑
  float sampleSoftPerlin(vec2 uv, vec2 offset) {
    vec2 blur = vec2(0.0025, 0.0025);
    float value = texture2D(tPerlin, uv + offset).r;
    value += texture2D(tPerlin, uv + offset + blur * vec2(1.0, -1.0)).r;
    value += texture2D(tPerlin, uv + offset + blur * vec2(-1.2, 0.8)).r;
    value += texture2D(tPerlin, uv + offset + blur * vec2(0.6, 1.3)).r;
    return value * 0.25;
  }

  void main() {
    // 1. 修正宽高比，确保背景元素不随窗口拉伸而变形
    vec2 screenUv = vUv;
    screenUv.x *= max(uAspect, 0.0001);
    screenUv *= 0.3; // 缩放噪声尺度

    // 2. 计算动态偏移
    float t = uTime * 0.075;
    vec2 offset1 = vec2(-t, t * 0.25);
    vec2 offset2 = vec2(t, -t * 0.5);
    // 将滚动进度映射到 y 轴位移，产生一种内容向上移动的视觉暗示
    offset1.y -= uProgress * 0.25;
    offset1.y -= uProgress * 0.4;

    // 3. 叠加双层噪声：生成具有复杂深度的流体感纹理
    float perlin = sampleSoftPerlin(screenUv, offset1);
    perlin += sampleSoftPerlin(screenUv * 0.5, offset2);
    perlin *= 0.5;

    // 4. 色彩映射
    float grad = smoothstep(0.05, 0.88, perlin);
    vec3 color = mix(uColor1, uColor2, grad * 0.9);
    
    // 5. 中心辉光：在画面中心偏右上方添加一个柔和的光源感
    float centerGlow = 1.0 - smoothstep(0.0, 0.92, length(vUv - vec2(0.58, 0.46)) * 1.25);
    color = mix(color, vec3(1.0), centerGlow * uCenterGlowStrength);

    // 6. 叠加动态点阵
    vec2 dotUv = screenUv * 45.0;
    dotUv += vec2(0.0, -uProgress * 10.0); // 点阵位移随滚动加速
    float dots = texture2D(tDotPattern, dotUv).r;
    float dotId = hash12(floor(dotUv));
    // 基于随机 ID 和时间产生呼吸闪烁效果
    float dotFade = 1.0 - abs(fract(dotId + uTime * 0.1) - 0.5) * 2.0;
    color += dots * dotFade * uDotStrength;

    // 7. 蓝噪声抖动 (Dithering)
    // 这是提升 WebGL 项目质感的关键细节，能有效防止渐变处的色块问题
    vec3 blueNoise = getBlueNoise(gl_FragCoord.xy).rgb;
    color += blueNoise * uBlueNoiseStrength;
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** SharedBackdrop 构造选项 */
export interface SharedBackdropOptions {
  perlinTexture: THREE.Texture;
  dotPatternTexture: THREE.Texture;
  blueNoiseTexture: THREE.Texture;
}

/**
 * 几何体优化：创建全屏三角形几何体。
 * 相比传统的 Plane (2个面片)，单个巨大的三角形只需要 3 个顶点即可覆盖全屏，
 * 是目前最工业标准的 Fullscreen Pass 做法。
 */
function createFullscreenTriangleGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2),
  );
  return geometry;
}

/**
 * SharedBackdrop 类：
 * 实现了 RenderLayer 接口，作为 TransitionRenderer 的底层注入。
 */
export class SharedBackdrop {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private blueOffset = new THREE.Vector2();
  private progress = 0;

  constructor(opts: SharedBackdropOptions) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uAspect: { value: 1 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uColor1: { value: new THREE.Color('#a3b0cf') },
        uColor2: { value: new THREE.Color('#7c8699') },
        tPerlin: { value: opts.perlinTexture },
        tDotPattern: { value: opts.dotPatternTexture },
        tBlue: { value: opts.blueNoiseTexture },
        uBlueOffset: { value: this.blueOffset.clone() },
        uDotStrength: { value: 1.0 },
        uBlueNoiseStrength: { value: 0.018 },
        uCenterGlowStrength: { value: 0.5 },
      },
      vertexShader: CUBES_BG_VERTEX_SHADER,
      fragmentShader: CUBES_BG_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false, // 背景不需要色调映射，保持其原本的清透感
    });

    this.mesh = new THREE.Mesh(createFullscreenTriangleGeometry(), this.material);
    this.mesh.frustumCulled = false; // 全屏 Pass 必须关闭视锥剔除
    this.mesh.renderOrder = -99;    // 确保它在任何东西之前渲染
    this.scene.add(this.mesh);
  }

  /** 更新进度 */
  setProgress(progress: number) {
    this.progress = progress;
  }

  // --- Setter 方法：供调试面板控制 ---
  setColor1(value: string) {
    this.material.uniforms.uColor1.value.set(value);
  }

  setColor2(value: string) {
    this.material.uniforms.uColor2.value.set(value);
  }

  setDotStrength(value: number) {
    this.material.uniforms.uDotStrength.value = value;
  }

  setBlueNoiseStrength(value: number) {
    this.material.uniforms.uBlueNoiseStrength.value = value;
  }

  setCenterGlowStrength(value: number) {
    this.material.uniforms.uCenterGlowStrength.value = value;
  }

  /** 更新视口宽高比 */
  setSize(width: number, height: number) {
    this.material.uniforms.uAspect.value = width / Math.max(height, 1);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  /** 每帧逻辑 */
  update(_delta: number, elapsed: number) {
    // 蓝噪声偏移：使用 0.618 (黄金比例) 进行累加，
    // 这种数学技巧能确保采样点在很长一段时间内不出现周期性重复。
    this.blueOffset.set(
      (this.blueOffset.x + 0.61803398875) % 1,
      (this.blueOffset.y + 0.41421356237) % 1,
    );

    this.material.uniforms.uTime.value = elapsed;
    this.material.uniforms.uProgress.value = this.progress;
    this.material.uniforms.uBlueOffset.value.copy(this.blueOffset);
  }

  /** 清理资源 */
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
