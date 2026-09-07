import { debugViewDefines } from "modules/debugViews.js";

const shader = `precision highp float;

${debugViewDefines}

uniform sampler2D colorMap;
uniform sampler2D positionMap;
uniform sampler2D normalMap;
uniform vec3 backgroundSky;
uniform vec3 backgroundGround;
uniform mat4 cameraProjectionInverse;
uniform vec3 aoColor;
uniform float bias;
uniform float radius;
uniform float strength;
uniform vec2 attenuation;
uniform sampler2D shadowMap;
uniform mat4 shadowViewMatrix;
uniform mat4 shadowProjectionMatrix;
uniform mat4 viewMatrixInverse;
uniform vec3 shadowColor;
uniform float shadowRadius;
uniform float shadowBias;
uniform float shadowStrength;
uniform sampler2D velocityMap;
uniform sampler2D pointLightMap;
uniform int debugView;
uniform vec2 depthRange;
uniform float fogDensity;
uniform mat4 cameraProjection;
uniform vec3 pointLightPosition;
uniform float pointShadowStrength;
uniform float pointShadowBias;
uniform float pointShadowThickness;
uniform float pointShadowSoftness;
uniform sampler2D blueNoise;
uniform int blueNoiseSize;
uniform int pointShadowSteps;
uniform int pointShadowRays;

in vec2 vUv;

out vec4 fragColor;

#define M_PI 3.1415926535897932384626433832795

float sampleBuffer(vec3 position, vec3 normal, vec2 uv) {
  vec4 probe = texture(positionMap, uv);
  if (probe.w <= 0.0) return 0.0;

  vec3 dir = probe.xyz - position;
  float intensity = max(dot(normalize(dir), normal) - bias, 0.0);
  float dist = length(dir);
  float factor = 1.0 / (attenuation.x + attenuation.y * dist);

  return intensity * factor;
}

float random(vec2 n, float offset) {
  return 0.5 - fract(sin(dot(n.xy + vec2(offset, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
}

const vec2 POISSON[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457),
  vec2(-0.203, 0.621), vec2(0.962, -0.195), vec2(0.473, -0.480),
  vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064),
  vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

vec3 backgroundAt(vec2 uv) {
  vec4 ray = cameraProjectionInverse * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec3 dir = normalize(mat3(viewMatrixInverse) * (ray.xyz / ray.w));
  return mix(
    backgroundGround,
    backgroundSky,
    dir.y * 0.5 + 0.5
  );
}

float fogAt(vec3 viewPosition) {
  if (fogDensity <= 0.0) return 0.0;
  float depth = -viewPosition.z;
  float f = fogDensity * depth;
  return 1.0 - exp(-f * f);
}

vec3 shadowTint(float lit, float strength) {
  return mix(shadowColor, vec3(1.0), mix(1.0, clamp(lit, 0.0, 1.0), strength));
}

vec2 blueNoiseAt(vec2 p) {
  return texelFetch(blueNoise, ivec2(p) % blueNoiseSize, 0).rg;
}

float pointShadowRay(vec3 origin, vec3 target, float jitter) {
  vec3 toTarget = target - origin;
  float dist = length(toTarget);
  if (dist < 1e-4) return 0.0;
  vec3 L = toTarget / dist;

  for (int i = 1; i <= 32; i++) {
    if (i > pointShadowSteps) break;

    float t = ((float(i) - 1.0 + jitter) / float(pointShadowSteps)) * dist;
    vec3 p = origin + L * t;

    vec4 clip = cameraProjection * vec4(p, 1.0);
    if (clip.w <= 0.0) break;
    vec2 sampleUv = clip.xy / clip.w * 0.5 + 0.5;
    if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) break;

    vec4 scene = texture(positionMap, sampleUv);
    if (scene.w <= 0.0) continue;

    float delta = scene.z - p.z;
    if (delta > pointShadowBias && delta < pointShadowThickness) {
      return 1.0;
    }
  }

  return 0.0;
}

float pointOcclusion(vec3 viewPosition, vec3 viewNormal) {
  if (pointShadowStrength <= 0.0 || pointShadowSteps <= 0) return 0.0;

  vec3 toLight = pointLightPosition - viewPosition;
  float dist = length(toLight);
  if (dist < 1e-4) return 0.0;

  vec3 L = toLight / dist;
  if (dot(viewNormal, L) <= 0.0) return 0.0;

  vec2 noise = blueNoiseAt(gl_FragCoord.xy);
  float jitter = noise.y;
  vec3 origin = viewPosition + viewNormal * pointShadowBias;

  vec3 helper = abs(L.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 tx = normalize(cross(helper, L));
  vec3 ty = cross(L, tx);

  float angle = noise.x * 6.2831853;

  int rays = pointShadowSoftness < 1e-4 ? 1 : clamp(pointShadowRays, 1, 8);
  float spread = rays > 1 ? pointShadowSoftness : 0.0;
  float occluded = 0.0;

  for (int r = 0; r < 8; r++) {
    if (r >= rays) break;

    float t = (float(r) + 0.5) / float(rays);
    float a = angle + float(r) * 2.39996323;
    vec2 d = vec2(cos(a), sin(a)) * sqrt(t) * spread;
    vec3 target = pointLightPosition + tx * d.x + ty * d.y;

    occluded += pointShadowRay(origin, target, jitter);
  }

  return clamp(occluded / float(rays), 0.0, 1.0);
}

float shadowFactor(vec3 viewPosition, vec3 viewNormal, vec2 uv) {
  vec3 worldPos = (viewMatrixInverse * vec4(viewPosition, 1.0)).xyz;
  vec3 worldNormal = normalize(mat3(viewMatrixInverse) * viewNormal);

  vec4 lightView = shadowViewMatrix * vec4(worldPos + worldNormal * shadowBias, 1.0);
  float depth = -lightView.z;

  vec4 clip = shadowProjectionMatrix * lightView;
  vec3 ndc = clip.xyz / clip.w;
  vec2 shadowUv = ndc.xy * 0.5 + 0.5;

  if (shadowUv.x < 0.0 || shadowUv.x > 1.0 || shadowUv.y < 0.0 || shadowUv.y > 1.0) {
    return 1.0;
  }

  vec2 texel = 1.0 / vec2(textureSize(shadowMap, 0));
  float angle = random(uv, 7.0) * 6.2831853;
  float ca = cos(angle);
  float sa = sin(angle);

  float lit = 0.0;
  for (int i = 0; i < 12; i++) {
    vec2 o = POISSON[i];
    vec2 r = vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca);
    float stored = texture(shadowMap, shadowUv + r * texel * shadowRadius).r;
    lit += (stored <= 0.0 || stored >= depth) ? 1.0 : 0.0;
  }

  return lit / 12.0;
}

void main() {
  vec4 color = texture(colorMap, vUv);
  vec4 posDepth = texture(positionMap, vUv);

  if (debugView == VIEW_ALBEDO) {
    fragColor = vec4(color.rgb, 1.0);
    return;
  }
  if (debugView == VIEW_NORMALS) {
    fragColor = vec4(normalize(texture(normalMap, vUv).xyz) * 0.5 + 0.5, 1.0);
    return;
  }
  if (debugView == VIEW_POSITION) {
    fragColor = vec4(fract(abs(posDepth.xyz)), 1.0);
    return;
  }
  if (debugView == VIEW_DEPTH) {
    if (posDepth.w == 0.0) {
      fragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    float span = max(depthRange.y - depthRange.x, 1e-4);
    float d = clamp((length(posDepth.xyz) - depthRange.x) / span, 0.0, 1.0);
    fragColor = vec4(vec3(1.0 - d), 1.0);
    return;
  }
  if (debugView == VIEW_VELOCITY) {
    fragColor = vec4(abs(texture(velocityMap, vUv).xy) * 20.0, 0.0, 1.0);
    return;
  }
  if (debugView == VIEW_CURSORLIGHT) {
    fragColor = vec4(texture(pointLightMap, vUv).rgb, 1.0);
    return;
  }
  if (debugView == VIEW_CURSORSHADOW) {
    if (posDepth.w == 0.0) {
      fragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec3 n9 = normalize(texture(normalMap, vUv).xyz);
    float occ9 = pointOcclusion(posDepth.xyz, n9);
    fragColor = vec4(shadowTint(1.0 - occ9, pointShadowStrength), 1.0);
    return;
  }

  if (posDepth.w == 0.0) {
    fragColor = vec4(backgroundAt(vUv), 1.0);
    return;
  }

  if (posDepth.w < 0.0) {
    fragColor = vec4(color.rgb, 1.0);
    return;
  }

  vec2 inc = 1.0 / vec2(textureSize(colorMap, 0));
  vec3 position = posDepth.xyz;
  vec3 normal = normalize(texture(normalMap, vUv).xyz);
  vec2 randVec = normalize(vec2(random(vUv, 1.0), random(vUv.yx, 1.0)));

  float kRadius = radius * (1.0 - abs(posDepth.w));

  vec2 k[4];
  k[0] = vec2(0.0, 1.0);
  k[1] = vec2(1.0, 0.0);
  k[2] = vec2(0.0, -1.0);
  k[3] = vec2(-1.0, 0.0);

  const float v = M_PI / 4.0;
  float occlusion = 0.0;

  for (int i = 0; i < 4; ++i) {
    vec2 k1 = reflect(k[i], randVec);
    vec2 k2 = vec2(k1.x * v - k1.y * v, k1.x * v + k1.y * v);
    k1 *= inc;
    k2 *= inc;

    occlusion += sampleBuffer(position, normal, vUv + k1 * kRadius);
    occlusion += sampleBuffer(position, normal, vUv + k2 * kRadius * 0.75);
    occlusion += sampleBuffer(position, normal, vUv + k1 * kRadius * 0.5);
    occlusion += sampleBuffer(position, normal, vUv + k2 * kRadius * 0.25);
  }

  occlusion = clamp(occlusion / 16.0, 0.0, 1.0);

  vec3 tint = mix(vec3(1.0), aoColor, clamp(occlusion * strength, 0.0, 1.0));

  float lit = shadowFactor(position, normal, vUv);
  vec3 shade = shadowTint(lit, shadowStrength);

  if (debugView == VIEW_AO) {
    fragColor = vec4(vec3(1.0 - clamp(occlusion * strength, 0.0, 1.0)), 1.0);
    return;
  }
  if (debugView == VIEW_SHADOW) {
    fragColor = vec4(vec3(mix(1.0, lit, shadowStrength)), 1.0);
    return;
  }

  vec3 pointLit = texture(pointLightMap, vUv).rgb;
  vec3 base = max(color.rgb - pointLit, vec3(0.0));

  vec3 pShade = vec3(1.0);
  if (dot(pointLit, vec3(0.2126, 0.7152, 0.0722)) > 0.002) {
    pShade = shadowTint(
      1.0 - pointOcclusion(position, normal),
      pointShadowStrength
    );
  }

  vec3 shaded = (base * shade + pointLit * pShade) * tint;
  fragColor = vec4(mix(shaded, backgroundAt(vUv), fogAt(position)), 1.0);
}`;

export { shader };
