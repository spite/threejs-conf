import { debugViewDefines } from "modules/debugViews.js";

const shader = `precision highp float;

${debugViewDefines}

uniform sampler2D sceneMap;
uniform sampler2D velocityMap;
uniform sampler2D bloom0;
uniform sampler2D bloom1;
uniform sampler2D bloom2;
uniform sampler2D bloom3;
uniform sampler2D bloom4;
uniform float bloomStrength;
uniform float bloomRadius;
uniform sampler2D blueNoise;
uniform int blueNoiseSize;
uniform float vignette;
uniform float dither;
uniform int debugView;
uniform float shutter;
uniform float maxVelocity;
uniform float samples;
uniform float toneMappingExposure;

in vec2 vUv;

out vec4 fragColor;

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

vec3 ACESFilmicToneMapping(vec3 color) {
  const mat3 ACESInputMat = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777
  );
  const mat3 ACESOutputMat = mat3(
    1.60475, -0.10208, -0.00327,
    -0.53108, 1.10813, -0.07276,
    -0.07367, -0.00605, 1.07602
  );
  color *= toneMappingExposure / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, vec3(0.0), vec3(1.0));
}

vec3 linearToSRGB(vec3 value) {
  return mix(
    pow(value, vec3(0.41666)) * 1.055 - vec3(0.055),
    value * 12.92,
    vec3(lessThanEqual(value, vec3(0.0031308)))
  );
}

vec2 dilatedVelocity(vec2 uv, vec2 texel) {
  vec2 best = textureLod(velocityMap, uv, 0.0).xy;
  float bestLen = dot(best, best);

  for (int i = 0; i < 8; i++) {
    float a = (float(i) / 8.0) * 6.2831853;
    vec2 o = vec2(cos(a), sin(a)) * texel * 6.0;
    vec2 v = textureLod(velocityMap, uv + o, 0.0).xy;
    float l = dot(v, v);
    if (l > bestLen) {
      bestLen = l;
      best = v;
    }
  }

  return best;
}

float interleavedGradient(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float blueNoiseAt(vec2 p) {
  return texelFetch(blueNoise, ivec2(p) % blueNoiseSize, 0).g;
}

float bloomFactor(float factor) {
  return mix(factor, 1.2 - factor, bloomRadius);
}

void main() {
  if (debugView != VIEW_BEAUTY) {
    fragColor = vec4(texture(sceneMap, vUv).rgb, 1.0);
    return;
  }

  vec2 centred = vUv - 0.5;

  vec2 texel = 1.0 / vec2(textureSize(sceneMap, 0));
  vec2 velocity = shutter > 0.0 ? dilatedVelocity(vUv, texel) * shutter : vec2(0.0);

  float len = length(velocity);
  if (len > maxVelocity) velocity *= maxVelocity / len;

  float pixels = length(velocity / texel);
  int count = int(clamp(pixels, 1.0, samples));

  float jitter = blueNoiseAt(gl_FragCoord.xy);
  vec3 sum = vec3(0.0);
  float total = 0.0;

  for (int i = 0; i < 32; i++) {
    if (i >= count) break;
    float t = (float(i) + jitter) / float(count) - 0.5;
    sum += textureLod(sceneMap, vUv + velocity * t, 0.0).rgb;
    total += 1.0;
  }

  vec3 color = sum / max(total, 1.0);

  if (bloomStrength > 0.0) {
    vec3 b = bloomFactor(1.0) * texture(bloom0, vUv).rgb;
    b += bloomFactor(0.8) * texture(bloom1, vUv).rgb;
    b += bloomFactor(0.6) * texture(bloom2, vUv).rgb;
    b += bloomFactor(0.4) * texture(bloom3, vUv).rgb;
    b += bloomFactor(0.2) * texture(bloom4, vUv).rgb;
    color += (b / 3.0) * bloomStrength;
  }

  if (vignette > 0.0) {
    float edge = length(centred) * 2.0;
    color *= mix(1.0, smoothstep(1.5, 0.35, edge), vignette);
  }

  vec3 graded = linearToSRGB(ACESFilmicToneMapping(color));
  graded += (interleavedGradient(gl_FragCoord.xy) - 0.5) * dither / 255.0;
  fragColor = vec4(graded, 1.0);
}`;

export { shader };
