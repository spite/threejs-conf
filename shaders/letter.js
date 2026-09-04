import { shader as triplanar } from "shaders/triplanar.js";

const shader = `
${triplanar}

uniform float texScale;
uniform float blendSharpness;
uniform vec3 rimColor;
uniform float rimStrength;
uniform float rimPower;
uniform float cameraNear;
uniform float cameraFar;

float viewDepth(float dist) {
    return clamp((dist - cameraNear) / (cameraFar - cameraNear), 1e-3, 1.0);
}

vec3 rotateFromTo(vec3 a, vec3 b, vec3 v) {
    vec3 axis = cross(a, b);
    float s = length(axis);
    float c = dot(a, b);
    if (s < 1e-6) return c < 0.0 ? -v : v;
    axis /= s;
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main() { 

    mat3 viewMatrixInverse = mat3(inverse(viewMatrix));
    vec3 worldNormal = normalize(viewMatrixInverse * vNormal);
    vec3 matNormal = normalize(vObjectNormal);

    float r = roughness;
    float m = metalness;

    if (hasNormalMap) {
        vec3 perturbed = triplanarNormal(vPosition, matNormal, normalMap, texScale, normalScale, blendSharpness);
        worldNormal = normalize(rotateFromTo(matNormal, worldNormal, perturbed));
    }
    if (hasRoughnessMap) {
        vec4 texColor = triplanarTexture(vPosition, matNormal, roughnessMap, texScale, blendSharpness);
        r = clamp(r + (texColor.r - 0.5) * roughnessScale, 0.0, 1.0);
    }
    vec4 diffuseColor = vec4(color, 1.0);

    vec3 pointContribution;
    vec3 outgoingLight = shade(vWorldPosition, worldNormal, vUv, diffuseColor, r, m, pointContribution);

    if (rimStrength > 0.0) {
        vec3 toEye = normalize(cameraPosition - vWorldPosition);
        float rim = pow(1.0 - clamp(dot(worldNormal, toEye), 0.0, 1.0), rimPower);
        outgoingLight += rimColor * rim * rimStrength;
    }

    fragColor = vec4(outgoingLight, 1.0);
    fragPointLight = vec4(pointContribution, 1.0);

    vec3 viewPosition = -vViewPosition;
    fragPosition = vec4(viewPosition, viewDepth(length(viewPosition)));
    fragNormal = vec4(normalize(mat3(viewMatrix) * worldNormal), 1.0);

    vec2 nowNdc = vClipCurrent.xy / vClipCurrent.w;
    vec2 wasNdc = vClipPrevious.xy / vClipPrevious.w;
    fragVelocity = vec4((nowNdc - wasNdc) * 0.5, 0.0, 1.0);
}
`;

export { shader };
