const shader = `
uniform float cameraNear;
uniform float cameraFar;

void main() {
    fragColor = vec4(color, 1.0);

    vec3 viewPosition = -vViewPosition;
    fragPosition = vec4(viewPosition, -clamp((length(viewPosition) - cameraNear) / (cameraFar - cameraNear), 1e-3, 1.0));
    fragNormal = vec4(normalize(vNormal), 1.0);
    vec2 nowNdc = vClipCurrent.xy / vClipCurrent.w;
    vec2 wasNdc = vClipPrevious.xy / vClipPrevious.w;
    fragVelocity = vec4((nowNdc - wasNdc) * 0.5, 0.0, 1.0);
    fragPointLight = vec4(0.0);
}
`;

export { shader };
