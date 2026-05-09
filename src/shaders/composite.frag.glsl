// composite.frag.glsl
// 色散云雾过渡片元着色器。
//
// 从 igloo-rebuild HomeSceneRenderer 的 COMPOSITE_FRAGMENT_SHADER 简化而来：
// - 保留：renderHomeTransition()（斜切 cut + 云雾位移 + 色差 + 蓝噪声抖动）
// - 删除：renderDetailTransition()、tDetail / tCubes / tFrost / uDetailProgress*
//
// uMix 为过渡进度 0..1；uProgressVel 为滚动速度强度 0..1。
uniform sampler2D tSceneA;
uniform sampler2D tSceneB;
uniform sampler2D tScroll;
uniform sampler2D tBlue;
uniform vec2 uResolution;
uniform vec2 uBlueOffset;
uniform float uMix;
uniform float uProgressVel;
uniform float uHomeChromaticStrength;
uniform float uHomeEdgeSoftness;
uniform float uSceneMistStrength;

varying vec2 vUv;

float fit(float value, float minA, float maxA, float minB, float maxB) {
  float normalized = clamp((value - minA) / max(maxA - minA, 0.0001), 0.0, 1.0);
  return mix(minB, maxB, normalized);
}

float cubicIn(float value) {
  return value * value * value;
}

float linstep(float begin, float end, float value) {
  return clamp((value - begin) / (end - begin), 0.0, 1.0);
}

float falloff(float value, float start, float end, float margin, float progress) {
  float direction = sign(end - start);
  float offset = margin * direction;
  float pivot = mix(start - offset, end, clamp(progress, 0.0, 1.0));
  return linstep(pivot + offset, pivot, value);
}

vec4 getBlueNoise(vec2 fragCoord, vec2 offset) {
  return texture2D(tBlue, fract(fragCoord / 128.0 + offset));
}

// 5 次光谱采样 + 径向扭曲，模拟色散（chromatic aberration）。
vec4 chromaticAberration(sampler2D source, vec2 uv, float strength, float bend) {
  vec4 accumulated = vec4(0.0);
  vec4 weight = vec4(0.0);

  for (int index = 0; index < 5; index += 1) {
    float t = float(index) / 4.0;
    vec2 centered = uv - 0.5;
    float distortion = bend * strength * t * dot(centered, centered);
    vec2 sampleUv = uv + centered * distortion;
    vec4 spectrum = vec4(
      smoothstep(0.0, 0.55, 1.0 - abs(t - 0.1) * 2.0),
      smoothstep(0.0, 0.75, 1.0 - abs(t - 0.5) * 2.0),
      smoothstep(0.0, 0.55, 1.0 - abs(t - 0.9) * 2.0),
      1.0
    );
    accumulated += spectrum * texture2D(source, sampleUv);
    weight += spectrum;
  }

  return accumulated / max(weight, vec4(0.0001));
}

// home 风格的斜切云雾过渡。
vec3 renderHomeTransition() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 dataUv = vUv - 0.5;
  dataUv.x *= aspect;
  dataUv += 0.5;

  vec3 scrollData = texture2D(tScroll, dataUv).rgb;
  float slopeDisplacement = (scrollData.b * 2.0 - 1.0) * 0.4;
  float slope = -0.2 * aspect * step(0.0, uMix);
  float inclination = mix(1.0 - vUv.x + slopeDisplacement, vUv.x + slopeDisplacement, step(slope, 0.0));
  float cutProgress = fit(uMix, 0.0, 1.0, 0.0, 1.0 + abs(slope));
  float diagonalValue = vUv.y + inclination * abs(slope);
  float edgeSoftness = max(uHomeEdgeSoftness, 0.05);

  float cutDiagonalBlur = falloff(diagonalValue, 0.0, 1.0, 2.0 * edgeSoftness, cutProgress);
  float cutDiagonalDisplacement = falloff(diagonalValue, 0.0, 1.0, 0.9 * edgeSoftness, cutProgress);
  float techDisplacement = falloff(scrollData.g, 0.0, 1.0, 1.0 * edgeSoftness, cutDiagonalDisplacement);
  float cutDiagonal = falloff(diagonalValue, 0.0, 1.0, 0.2 * edgeSoftness, cutProgress);
  float cut = falloff(scrollData.r, 0.0, 1.0, 2.0 * edgeSoftness, cutDiagonal);

  float modulator = 12.0
    * uHomeChromaticStrength
    * smoothstep(1.0, 0.7, abs(vUv.x * 2.0 - 1.0))
    * smoothstep(1.0, 0.7, abs(vUv.y * 2.0 - 1.0));
  vec4 noise = getBlueNoise(gl_FragCoord.xy, uBlueOffset);
  float velocityBoost = 0.65 + uProgressVel * 2.4;

  vec2 sceneADisplacement = vec2(
    0.0,
    0.4 * cubicIn(clamp(uMix, 0.0, 1.0))
      + 0.025 * techDisplacement * velocityBoost
  );
  vec2 sceneBDisplacement = vec2(
    0.0,
    0.4 * cubicIn(clamp(1.0 - uMix, 0.0, 1.0))
      + 0.025 * (1.0 - techDisplacement) * velocityBoost
  );

  vec3 sceneA = chromaticAberration(
    tSceneA,
    vUv - sceneADisplacement,
    modulator,
    cutDiagonalBlur * noise.r
  ).rgb;
  vec3 sceneB = chromaticAberration(
    tSceneB,
    vUv + sceneBDisplacement,
    modulator,
    (1.0 - cutDiagonalBlur) * noise.g
  ).rgb;

  return clamp(mix(sceneA, sceneB, cut), 0.0, 1.0);
}

vec3 applySceneMist(vec3 color) {
  float bottomFog = smoothstep(0.42, 0.02, vUv.y);
  float leftFog = smoothstep(0.18, 0.0, vUv.x) * 0.36;
  float rightFog = smoothstep(0.82, 1.0, vUv.x) * 0.28;
  float centerGlow = 1.0 - smoothstep(0.0, 0.74, length((vUv - vec2(0.54, 0.46)) * vec2(1.0, 1.2)));
  float upperWash = smoothstep(0.98, 0.24, vUv.y) * 0.12;
  float mist = clamp(bottomFog * 0.52 + leftFog + rightFog + centerGlow * 0.2 + upperWash, 0.0, 0.82);
  vec3 mistColor = vec3(0.82, 0.88, 0.94);
  return mix(color, mistColor, mist * clamp(uSceneMistStrength, 0.0, 1.0));
}

void main() {
  // uMix ≈ 0 时直接采样 sceneA，避免多余计算。
  vec3 color = uMix > 0.001
    ? renderHomeTransition()
    : texture2D(tSceneA, vUv).rgb;

  color = applySceneMist(color);

  gl_FragColor = vec4(color, 1.0);
}
