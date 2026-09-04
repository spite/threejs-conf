import {
  RawShaderMaterial,
  GLSL3,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  BufferAttribute,
  DynamicDrawUsage,
  Mesh,
  Camera,
  Vector2,
  Color,
} from "three";
import { stampInstances } from "modules/stampTexture.js";
import { shader as vertexShader } from "shaders/stampVs.js";
import { shader as fragmentShader } from "shaders/stampFs.js";

const MAX_STAMPS = 6000;
const WRAP_COPIES = 9;

class StampPass {
  constructor(renderer, capacity = MAX_STAMPS * WRAP_COPIES) {
    this.renderer = renderer;
    this.data = new Float32Array(capacity * 5);

    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
        ]),
        3,
      ),
    );
    geometry.setAttribute(
      "uv",
      new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const buffer = new InstancedInterleavedBuffer(this.data, 5);
    buffer.setUsage(DynamicDrawUsage);
    geometry.setAttribute("stamp", new InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute(
      "stampAlpha",
      new InterleavedBufferAttribute(buffer, 1, 4),
    );
    this.buffer = buffer;

    this.material = new RawShaderMaterial({
      uniforms: {
        sdf: { value: null },
        resolution: { value: new Vector2(1, 1) },
      },
      vertexShader,
      fragmentShader,
      glslVersion: GLSL3,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.camera = new Camera();
    this.clear = new Color();
  }

  paint(target, glyph, seed, options) {
    const renderer = this.renderer;
    const size = target.width;
    const count = stampInstances(glyph, seed, size, options, this.data);

    this.material.uniforms.sdf.value = glyph.texture;
    this.material.uniforms.resolution.value.set(size, size);
    this.buffer.needsUpdate = true;
    this.mesh.geometry.instanceCount = count;

    renderer.getClearColor(this.clear);
    const alpha = renderer.getClearAlpha();
    const previous = renderer.getRenderTarget();

    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    if (count > 0) renderer.render(this.mesh, this.camera);

    renderer.setRenderTarget(previous);
    renderer.setClearColor(this.clear, alpha);
    return count;
  }
}

export { StampPass };
