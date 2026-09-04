const shader = `precision highp float;

in float vDepth;

out vec4 fragColor;

void main() {
  fragColor = vec4(vDepth, 0.0, 0.0, 1.0);
}`;

export { shader };
