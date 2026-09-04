import { shader as heightToNormal } from "shaders/heightToNormal.js";

const shader = `precision highp float;

uniform sampler2D depth;

in vec2 vUv;

out vec4 fragColor;

${heightToNormal}

void main() {
  vec4 n = heightToNormal(depth, vUv, 1., -1., -1., 1., 0);
  fragColor = n;
}`;

export { shader };
