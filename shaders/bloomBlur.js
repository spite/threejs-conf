const shader = `precision highp float;

uniform sampler2D inputTexture;
uniform vec2 direction;
uniform vec2 texelSize;
uniform int taps;
uniform float prefilter;
uniform float threshold;

in vec2 vUv;

out vec4 color;

float gaussianPdf(float x, float sigma) {
  return 0.39894 * exp(-0.5 * x * x / (sigma * sigma)) / sigma;
}

vec3 fetch(vec2 uv) {
  vec3 c = texture(inputTexture, uv).rgb;
  if (prefilter > 0.5 && threshold > 0.0) {
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= smoothstep(threshold, threshold + threshold * 0.5 + 0.05, luma);
  }
  return c;
}

void main() {
  float sigma = float(taps) / 3.0;
  float weight = gaussianPdf(0.0, sigma);
  vec3 sum = fetch(vUv) * weight;
  float total = weight;

  for (int i = 1; i < 12; i++) {
    if (i >= taps) break;
    float x = float(i);
    float w = gaussianPdf(x, sigma);
    vec2 offset = direction * texelSize * x;
    sum += (fetch(vUv + offset) + fetch(vUv - offset)) * w;
    total += 2.0 * w;
  }

  color = vec4(sum / total, 1.0);
}`;

export { shader };
