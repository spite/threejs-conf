const shader = `precision highp float;

uniform sampler2D sdf;

in vec2 vUv;
in float vAlpha;

out vec4 color;

void main() {
  float d = texture(sdf, vUv).r;
  float w = max(0.5 * fwidth(d), 1e-4);
  float coverage = smoothstep(0.5 - w, 0.5 + w, d);
  if (coverage <= 0.0) discard;
  color = vec4(1.0, 1.0, 1.0, coverage * vAlpha);
}`;

export { shader };
