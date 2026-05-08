// composite.vert.glsl
// 全屏合成 pass 的顶点着色器：直接把 [-1, 1] 的 quad 映射成屏幕空间。
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
