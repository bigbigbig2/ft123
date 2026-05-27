uniform sampler2D tBackdrop;
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
uniform float uSmearStrength;
uniform float uSmearLength;
uniform float uSmearAngle;
uniform float uFogWashStrength;
uniform float uSceneBRevealStart;

varying vec2 vUv;

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float easeInOut(float value) {
  float t = saturate(value);
  return t * t * (3.0 - 2.0 * t);
}

float calcLuminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec4 sampleSafe(sampler2D source, vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec4(0.0);
  }
  return texture2D(source, uv);
}

vec3 unpremultiplyRgb(vec4 color) {
  float alpha = saturate(color.a);
  if (alpha <= 0.0001) {
    return vec3(0.0);
  }
  return color.rgb / alpha;
}

vec3 composeOver(vec3 base, vec4 layer) {
  return mix(base, layer.rgb, saturate(layer.a));
}

vec4 sampleChromaticStill(sampler2D source, vec2 uv, float strength) {
  vec2 center = uv - 0.5;
  float radial = dot(center, center);
  vec2 offset = center * radial * strength * 0.018;

  vec4 base = sampleSafe(source, uv);
  vec4 r = sampleSafe(source, uv + offset);
  vec4 b = sampleSafe(source, uv - offset);
  vec3 baseRgb = unpremultiplyRgb(base);
  vec3 rRgb = unpremultiplyRgb(r);
  vec3 bRgb = unpremultiplyRgb(b);

  vec4 color = vec4(vec3(rRgb.r, baseRgb.g, bRgb.b), max(base.a, max(r.a, b.a)));
  color.rgb = mix(baseRgb, color.rgb, saturate(strength));
  return color;
}

vec4 sampleChromaticSmear(sampler2D source, vec2 uv, vec2 direction, float amount, float chroma) {
  vec3 accumRGB = vec3(0.0);
  float accumAlpha = 0.0;
  vec3 weightSum = vec3(0.0);
  float alphaWeightSum = 0.0;
  
  const int SAMPLES = 30;
  // 简单的伪随机抖动，打散带状条纹
  float dither = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
  
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + dither) / float(SAMPLES);
    // 让拖尾的间距呈曲线分布，头部更密集，尾部更拉长
    float curveT = t * t * (3.0 - 2.0 * t); 
    
    vec2 offsetUv = uv - direction * (amount * curveT);
    vec4 samp = sampleSafe(source, offsetUv);
    vec3 sampRgb = unpremultiplyRgb(samp);
    
    // 生成彩虹色差权重：头部红，中部绿，尾部蓝
    float r = smoothstep(0.8, 0.0, t);
    float g = smoothstep(1.0, 0.0, abs(t - 0.4) * 2.0);
    float b = smoothstep(0.8, 0.0, 1.0 - t);
    
    // 基础透明度衰减 (越往后的轨迹越透明)
    float fade = exp(-t * 2.5);
    vec3 tint = mix(vec3(1.0), vec3(r, g, b), saturate(chroma)) * fade;
    
    // 关键：乘以 samp.a 避免透明背景污染边缘（消除黑边）
    accumRGB += sampRgb * samp.a * tint; 
    weightSum += samp.a * tint;
    
    accumAlpha += samp.a * fade;
    alphaWeightSum += fade;
  }
  
  vec3 finalRGB = accumRGB / max(weightSum, vec3(0.0001));
  float finalAlpha = saturate(accumAlpha / max(alphaWeightSum, 0.0001));
  
  return vec4(finalRGB, finalAlpha);
}

float transitionFogMask(float progress, float peak) {
  vec2 centered = (vUv - vec2(0.52, 0.48)) * vec2(1.0, 1.18);
  float centerWash = 1.0 - smoothstep(0.05, 0.92, length(centered));
  float bottomMist = smoothstep(0.44, 0.02, vUv.y);
  float topWash = smoothstep(0.62, 1.0, vUv.y) * smoothstep(0.04, 0.78, progress);
  float sideMist = (
    smoothstep(0.24, 0.0, vUv.x) +
    smoothstep(0.76, 1.0, vUv.x)
  ) * 0.18;

  return saturate(
    centerWash * (0.18 + peak * 0.42) +
    bottomMist * 0.34 +
    topWash * 0.32 +
    sideMist
  );
}

vec3 applySceneMist(vec3 color) {
  float bottomFog = smoothstep(0.42, 0.02, vUv.y);
  float leftFog = smoothstep(0.18, 0.0, vUv.x) * 0.36;
  float rightFog = smoothstep(0.82, 1.0, vUv.x) * 0.28;
  float centerGlow = 1.0 - smoothstep(0.0, 0.74, length((vUv - vec2(0.54, 0.46)) * vec2(1.0, 1.2)));
  float upperWash = smoothstep(0.98, 0.24, vUv.y) * 0.12;
  float mist = saturate(bottomFog * 0.52 + leftFog + rightFog + centerGlow * 0.2 + upperWash);
  vec3 mistColor = vec3(0.82, 0.88, 0.94);
  return mix(color, mistColor, mist * saturate(uSceneMistStrength));
}

void main() {
  float progress = easeInOut(uMix);
  float peak = sin(progress * 3.14159265);
  float velocityBoost = 1.0 + saturate(uProgressVel) * 0.65;
  float chroma = uHomeChromaticStrength * (0.22 + peak * 1.45) * velocityBoost;

  vec2 smearDirection = normalize(vec2(cos(uSmearAngle), sin(uSmearAngle)));
  vec3 backdrop = texture2D(tBackdrop, vUv).rgb;

  vec4 sceneA = progress > 0.001
    ? sampleChromaticSmear(
        tSceneA,
        vUv,
        smearDirection,
        uSmearLength * uSmearStrength * (0.16 + peak * 0.84) * velocityBoost,
        chroma
      )
    : sampleChromaticStill(tSceneA, vUv, uHomeChromaticStrength * 0.12);

  vec4 sceneB = sampleChromaticStill(
    tSceneB,
    vUv + smearDirection * (1.0 - progress) * 0.026 * uSmearStrength,
    uHomeChromaticStrength * smoothstep(uSceneBRevealStart, 1.0, progress) * 0.36
  );

  float aFade = 1.0 - smoothstep(0.42, 0.96, progress);
  float bFade = smoothstep(uSceneBRevealStart, 1.0, progress);
  float aGlow = saturate(calcLuminance(sceneA.rgb) * sceneA.a);

  sceneA.rgb = mix(sceneA.rgb, vec3(0.84, 0.91, 0.98), peak * 0.22 * aGlow);
  sceneA.a *= aFade;
  sceneB.a *= bFade;

  vec3 color = backdrop;
  color = composeOver(color, sceneA);
  color = composeOver(color, sceneB);

  float fogMask = transitionFogMask(progress, peak);
  float fogAmount = saturate(uFogWashStrength * smoothstep(0.08, 0.92, progress) * (0.2 + peak * 0.9));
  vec3 fogColor = vec3(0.80, 0.87, 0.94);
  color = mix(color, fogColor, fogMask * fogAmount);

  vec2 blueUv = fract(gl_FragCoord.xy / 128.0 + uBlueOffset);
  vec3 blue = texture2D(tBlue, blueUv).rgb - 0.5;
  color += blue * 0.012 * peak;
  color = applySceneMist(color);

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
