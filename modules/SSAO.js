import {
  GLSL3,
  RawShaderMaterial,
  NearestFilter,
  HalfFloatType,
  FloatType,
  RedFormat,
  Color,
  Vector2,
  Vector3,
  Matrix4,
  OrthographicCamera,
} from "three";
import { ShaderPass } from "modules/ShaderPass.js";
import { BloomPass } from "modules/bloomPass.js";
import { shader as depthVs } from "shaders/shadowVs.js";
import { shader as depthFs } from "shaders/shadowFs.js";
import { shader as ssaoFs } from "shaders/composite.js";
import { shader as blurFs } from "shaders/final.js";
import { shader as aberrationFs } from "shaders/aberration.js";
import { getFBO } from "modules/fbo.js";
import { shader as orthoVs } from "shaders/ortho.js";

class SSAO {
  constructor() {
    this.renderTarget = getFBO(1, 1, {
      count: 5,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });

    const types = [
      HalfFloatType,
      HalfFloatType,
      HalfFloatType,
      HalfFloatType,
      HalfFloatType,
    ];
    this.renderTarget.textures.forEach((texture, i) => {
      texture.minFilter = NearestFilter;
      texture.magFilter = NearestFilter;
      texture.type = types[i];
    });

    this.shadowFBO = getFBO(2048, 2048, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RedFormat,
      type: FloatType,
    });

    this.depthMaterial = new RawShaderMaterial({
      vertexShader: depthVs,
      fragmentShader: depthFs,
      glslVersion: GLSL3,
    });

    this.shadowCamera = new OrthographicCamera(-3, 3, 3, -3, 0.1, 30);
    this.shadowDistance = 4;
    this.lightDirection = new Vector3(3, 6, 3).normalize();
    this.shadowCenter = new Vector3();
    this.clearColor = new Color();
    this.shadowExtent = 2.2;

    this.color = this.renderTarget.textures[0];
    this.positions = this.renderTarget.textures[1];
    this.normals = this.renderTarget.textures[2];
    this.velocity = this.renderTarget.textures[3];
    this.pointLightMap = this.renderTarget.textures[4];

    this.shader = new RawShaderMaterial({
      uniforms: {
        colorMap: { value: this.color },
        positionMap: { value: this.positions },
        normalMap: { value: this.normals },
        backgroundSky: { value: new Color(0) },
        backgroundGround: { value: new Color(0) },
        cameraProjectionInverse: { value: new Matrix4() },
        aoColor: { value: new Color(0x2a2f3a) },
        bias: { value: 0.05 },
        radius: { value: 20 },
        strength: { value: 1 },
        attenuation: { value: new Vector2(1, 10) },
        shadowMap: { value: this.shadowFBO.texture },
        shadowViewMatrix: { value: new Matrix4() },
        shadowProjectionMatrix: { value: new Matrix4() },
        viewMatrixInverse: { value: new Matrix4() },
        shadowColor: { value: new Color(0x707890) },
        shadowRadius: { value: 3 },
        shadowBias: { value: 0.01 },
        shadowStrength: { value: 0.6 },
        velocityMap: { value: this.velocity },
        debugView: { value: 0 },
        depthRange: { value: new Vector2(1, 6) },
        fogDensity: { value: 0 },
        pointLightMap: { value: this.pointLightMap },
        cameraProjection: { value: new Matrix4() },
        pointLightPosition: { value: new Vector3() },
        pointShadowStrength: { value: 0.85 },
        pointShadowBias: { value: 0.012 },
        pointShadowThickness: { value: 0.35 },
        pointShadowSteps: { value: 16 },
        pointShadowSoftness: { value: 0.25 },
        pointShadowRays: { value: 4 },
        toneMappingExposure: { value: 1 },
      },
      vertexShader: orthoVs,
      fragmentShader: ssaoFs,
      glslVersion: GLSL3,
    });

    this.pass = new ShaderPass(this.shader, { type: HalfFloatType });

    this.aberrationShader = new RawShaderMaterial({
      uniforms: {
        inputTexture: { value: this.pass.texture },
        aberration: { value: 12 },
        resolution: { value: new Vector2(1, 1) },
      },
      vertexShader: orthoVs,
      fragmentShader: aberrationFs,
      glslVersion: GLSL3,
    });
    this.aberrationPass = new ShaderPass(this.aberrationShader, {
      type: HalfFloatType,
    });

    this.bloom = new BloomPass(3, 5, { type: HalfFloatType });

    this.blurShader = new RawShaderMaterial({
      uniforms: {
        sceneMap: { value: this.pass.texture },
        velocityMap: { value: this.velocity },
        debugView: { value: 0 },
        bloom0: { value: null },
        bloom1: { value: null },
        bloom2: { value: null },
        bloom3: { value: null },
        bloom4: { value: null },
        bloomStrength: { value: 0.4 },
        vignette: { value: 0.35 },
        dither: { value: 1 },
        shutter: { value: 0.5 },
        maxVelocity: { value: 0.06 },
        samples: { value: 16 },
        toneMappingExposure: { value: 1 },
      },
      vertexShader: orthoVs,
      fragmentShader: blurFs,
      glslVersion: GLSL3,
    });
    this.blurPass = new ShaderPass(this.blurShader);
  }

  setLight(x, y, z) {
    this.lightDirection.set(x, y, z).normalize();
  }

  fitShadow(center, radius) {
    const r = Math.max(radius, 1e-3);
    this.shadowCenter.copy(center);
    this.shadowExtent = r;

    const c = this.shadowCamera;
    c.left = -r;
    c.right = r;
    c.top = r;
    c.bottom = -r;
    c.near = 0.01;
    c.far = 2 * r + this.shadowDistance * r;
    c.updateProjectionMatrix();
  }

  updateShadow(renderer, scene) {
    const c = this.shadowCamera;
    c.position
      .copy(this.lightDirection)
      .multiplyScalar(this.shadowExtent * (1 + this.shadowDistance))
      .add(this.shadowCenter);
    c.lookAt(this.shadowCenter);
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();

    const u = this.shader.uniforms;
    u.shadowViewMatrix.value.copy(c.matrixWorldInverse);
    u.shadowProjectionMatrix.value.copy(c.projectionMatrix);

    const previous = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMaterial;

    renderer.setRenderTarget(this.shadowFBO);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, c);
    renderer.setRenderTarget(null);

    scene.overrideMaterial = previous;
  }

  setSize(width, height, dpr) {
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    this.renderTarget.setSize(w, h);
    this.pass.setSize(w, h);
    this.aberrationPass.setSize(w, h);
    this.blurPass.setSize(w, h);
    this.bloom.setSize(w, h);
    this.aberrationShader.uniforms.inputTexture.value = this.pass.texture;
    this.aberrationShader.uniforms.resolution.value.set(width, height);
  }

  render(renderer, scene, camera) {
    const clear = renderer.getClearColor(this.clearColor);
    const alpha = renderer.getClearAlpha();

    this.updateShadow(renderer, scene);

    camera.updateMatrixWorld();
    this.shader.uniforms.viewMatrixInverse.value.copy(camera.matrixWorld);
    this.shader.uniforms.cameraProjection.value.copy(camera.projectionMatrix);
    this.shader.uniforms.cameraProjectionInverse.value.copy(
      camera.projectionMatrixInverse,
    );

    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, alpha);

    this.pass.render(renderer);

    let scene2d = this.pass.texture;
    if (this.aberrationShader.uniforms.aberration.value > 0) {
      this.aberrationShader.uniforms.inputTexture.value = scene2d;
      this.aberrationPass.render(renderer);
      scene2d = this.aberrationPass.texture;
    }

    const u = this.blurShader.uniforms;
    if (u.bloomStrength.value > 0.0) {
      this.bloom.source = scene2d;
      this.bloom.render(renderer);
      for (let i = 0; i < 5; i++) {
        u[`bloom${i}`].value = this.bloom.blurPasses[i].texture;
      }
    }

    u.sceneMap.value = scene2d;
    this.blurPass.render(renderer, true);
  }

  dispose() {
    this.renderTarget.dispose();
    this.shadowFBO.dispose();
    this.depthMaterial.dispose();
    this.pass.dispose();
    this.blurPass.dispose();
  }
}

export { SSAO };
