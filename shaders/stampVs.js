const shader = `precision highp float;

in vec3 position;
in vec2 uv;
in vec4 stamp;
in float stampAlpha;

uniform vec2 resolution;

out vec2 vUv;
out float vAlpha;

void main() {
  float c = cos(stamp.z);
  float s = sin(stamp.z);
  vec2 p = position.xy * stamp.w;
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  p += stamp.xy;

  vUv = uv;
  vAlpha = stampAlpha;
  gl_Position = vec4((p / resolution) * 2.0 - 1.0, 0.0, 1.0);
}`;

export { shader };
