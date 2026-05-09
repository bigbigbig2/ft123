/**
 * SharedBackdrop.ts — 共享背景层
 *
 * 在所有场景底层渲染一个全屏动态背景：
 * 柏林噪声渐变 + 点阵叠加 + 蓝噪声抖动消除色阶。
 */
import * as THREE from 'three';

// ── 背景顶点着色器（全屏三角形直通） ─────────────────────────────
const CUBES_BG_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// ── 背景片元着色器 ───────────────────────────────────────────────
// 混合两层柏林噪声生成渐变底色，叠加点阵和蓝噪声抖动
const CUBES_BG_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;

  uniform float uTime;          // 累计时间（秒）
  uniform float uProgress;      // 全局滚动进度 0..1
  uniform float uAspect;        // 画布宽高比
  uniform vec2 uResolution;     // 画布分辨率（像素）
  uniform vec3 uColor1;         // 渐变色 1（浅灰蓝）
  uniform vec3 uColor2;         // 渐变色 2（近白色）
  uniform sampler2D tPerlin;    // 柏林噪声纹理
  uniform sampler2D tDotPattern;// 点阵纹理
  uniform sampler2D tBlue;      // 蓝噪声纹理
  uniform vec2 uBlueOffset;    // 蓝噪声逐帧偏移
  uniform float uDotStrength;  // 点阵叠加强度
  uniform float uBlueNoiseStrength;
  uniform float uCenterGlowStrength;

  // 简易二维哈希，为每个点阵格子分配随机 ID
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // 采样蓝噪声纹理（128×128 平铺）
  vec4 getBlueNoise(vec2 fragCoord) {
    float invSize = 1.0 / 128.0;
    return texture2D(tBlue, fragCoord * invSize + uBlueOffset);
  }

  // 4 次偏移采样取均值，实现柏林噪声的软模糊
  float sampleSoftPerlin(vec2 uv, vec2 offset) {
    vec2 blur = vec2(0.0025, 0.0025);
    float value = texture2D(tPerlin, uv + offset).r;
    value += texture2D(tPerlin, uv + offset + blur * vec2(1.0, -1.0)).r;
    value += texture2D(tPerlin, uv + offset + blur * vec2(-1.2, 0.8)).r;
    value += texture2D(tPerlin, uv + offset + blur * vec2(0.6, 1.3)).r;
    return value * 0.25;
  }

  void main() {
    // 宽高比修正，防止纹理变形
    vec2 screenUv = vUv;
    screenUv.x *= max(uAspect, 0.0001);
    screenUv *= 0.3;

    // 时间驱动偏移，让噪声缓慢流动
    float t = uTime * 0.075;
    vec2 offset1 = vec2(-t, t * 0.25);
    vec2 offset2 = vec2(t, -t * 0.5);
    // 滚动进度联动，产生视差效果
    offset1.y -= uProgress * 0.25;
    offset1.y -= uProgress * 0.4;

    // 叠加两层不同尺度的柏林噪声
    float perlin = sampleSoftPerlin(screenUv, offset1);
    perlin += sampleSoftPerlin(screenUv * 0.5, offset2);
    perlin *= 0.5;

    // 噪声值映射为两色渐变
    float grad = smoothstep(0.05, 0.88, perlin);
    vec3 color = mix(uColor1, uColor2, grad * 0.9);
    // 中心辉光（偏右上方的柔和白色光晕）
    float centerGlow = 1.0 - smoothstep(0.0, 0.92, length(vUv - vec2(0.58, 0.46)) * 1.25);
    color = mix(color, vec3(1.0), centerGlow * uCenterGlowStrength);

    // 点阵图案叠加，随滚动位移并有闪烁动画
    vec2 dotUv = screenUv * 45.0;
    dotUv += vec2(0.0, -uProgress * 10.0);
    float dots = texture2D(tDotPattern, dotUv).r;
    float dotId = hash12(floor(dotUv));
    float dotFade = 1.0 - abs(fract(dotId + uTime * 0.1) - 0.5) * 2.0;
    color += dots * dotFade * uDotStrength;

    // 蓝噪声抖动消除色阶条纹
    vec3 blueNoise = getBlueNoise(gl_FragCoord.xy).rgb;
    color += blueNoise * uBlueNoiseStrength;
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** SharedBackdrop 构造选项 */
export interface SharedBackdropOptions {
  perlinTexture: THREE.Texture;      // 柏林噪声纹理
  dotPatternTexture: THREE.Texture;  // 点阵纹理
  blueNoiseTexture: THREE.Texture;   // 蓝噪声纹理
}

/**
 * 创建全屏三角形几何体
 * 单个三角形覆盖整个视口，比 PlaneGeometry(2,2) 少一个面片，更高效
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
 * SharedBackdrop — 共享动态背景层
 *
 * 作为 RenderLayer 被 TransitionRenderer 使用，
 * 在每个场景的离屏渲染前先绘制此背景，实现所有场景统一的底色。
 */
export class SharedBackdrop {
  /** 背景专属场景，只含一个全屏三角形 */
  readonly scene = new THREE.Scene();
  /** 正交相机（NDC 直通） */
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  /** 蓝噪声偏移，每帧以黄金比例步进保证不重复 */
  private blueOffset = new THREE.Vector2();
  /** 当前全局滚动进度 */
  private progress = 0;

  constructor(opts: SharedBackdropOptions) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uAspect: { value: 1 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uColor1: { value: new THREE.Color('#aebdcd') },
        uColor2: { value: new THREE.Color('#edf4f8') },
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
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(createFullscreenTriangleGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -99;
    this.scene.add(this.mesh);
  }

  /** 设置全局滚动进度（0→1） */
  setProgress(progress: number) {
    this.progress = progress;
  }

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

  /** 响应画布尺寸变化 */
  setSize(width: number, height: number) {
    this.material.uniforms.uAspect.value = width / Math.max(height, 1);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  /** 每帧更新：推进蓝噪声偏移和时间 uniform */
  update(_delta: number, elapsed: number) {
    this.blueOffset.set(
      (this.blueOffset.x + 0.61803398875) % 1,
      (this.blueOffset.y + 0.41421356237) % 1,
    );

    this.material.uniforms.uTime.value = elapsed;
    this.material.uniforms.uProgress.value = this.progress;
    this.material.uniforms.uBlueOffset.value.copy(this.blueOffset);
  }

  /** 释放 GPU 资源 */
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
