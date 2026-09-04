const shader = `
precision highp float;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

in vec3 position;
in vec3 normal;
in vec2 uv;
in float thickness;

out vec3 vPosition;
out vec3 vViewPosition;
out vec3 vWorldPosition;
out vec3 vNormal;
out vec3 vObjectNormal;
out vec2 vUv;
out vec4 vClipCurrent;
out vec4 vClipPrevious;
out float vThickness;

uniform mat4 previousModelViewMatrix;

void main() {
    vUv = uv;
    vPosition = position;
    vObjectNormal = normalize(normal);
    vThickness = thickness;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPosition;
    vClipCurrent = gl_Position;
    vClipPrevious = projectionMatrix * previousModelViewMatrix * vec4(position, 1.0);
} `;

export { shader };
