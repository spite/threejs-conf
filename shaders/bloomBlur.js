import { blur13 } from "shaders/blur.js";

const shader = `precision highp float;

uniform sampler2D inputTexture;
uniform vec2 direction;

in vec2 vUv;

out vec4 color;

${blur13}

void main() {
  color = blur13(inputTexture, vUv, direction);
}`;

export { shader };
