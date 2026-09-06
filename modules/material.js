import {
  RawShaderMaterial,
  FloatType,
  Vector3,
  PMREMGenerator,
  Matrix4,
  DirectionalLight,
  AmbientLight,
  Vector2,
  HemisphereLight,
  PointLight,
  Color,
  GLSL3,
} from "three";
import { UltraHDRLoader } from "third_party/UltraHDRLoader.js";
import { shader as vertexShader } from "shaders/pbrVs.js";
import {
  shader as fragmentShader,
  MAX_DIR_LIGHTS,
  MAX_POINT_LIGHTS,
} from "shaders/pbr.js";

async function loadEnvMap(file, renderer) {
  return new Promise((resolve, reject) => {
    const loader = new UltraHDRLoader();
    loader.setDataType(FloatType);

    const pmremGenerator = new PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    loader.load(file, (texture) => {
      const pmremRT = pmremGenerator.fromEquirectangular(texture);
      resolve(pmremRT.texture);
    });
  });
}

const light = new DirectionalLight(0xffffff, 3);
light.position.set(3, 6, 3);
light.castShadow = true;
light.shadow.camera.top = 3;
light.shadow.camera.bottom = -3;
light.shadow.camera.right = 3;
light.shadow.camera.left = -3;
light.shadow.mapSize.set(4096, 4096);

const hemiLight = new HemisphereLight(0xffffff, 0xffffff, 2);
hemiLight.color.setHSL(0.6, 1, 0.6);
hemiLight.groundColor.setHSL(0.095, 1, 0.75);
hemiLight.position.set(0, 50, 0);

const sceneLights = {
  ambient: null,
  directional: [],
  hemisphere: [],
  point: [],
};

function collectLights(scene, out = sceneLights) {
  out.ambient = null;
  out.directional.length = 0;
  out.hemisphere.length = 0;
  out.point.length = 0;

  scene.traverse((object) => {
    if (object instanceof AmbientLight) out.ambient = object;
    else if (object instanceof DirectionalLight) out.directional.push(object);
    else if (object instanceof PointLight) out.point.push(object);
    else if (object instanceof HemisphereLight) out.hemisphere.push(object);
  });

  return out;
}

class Material extends RawShaderMaterial {
  constructor(params) {
    super({
      vertexShader: params.vertexShader ?? vertexShader,
      fragmentShader:
        (params.fragmentShader ?? fragmentShader) +
        params.main,
      uniforms: {
        color: { value: params.uniforms.color },
        roughness: { value: params.uniforms.roughness },
        metalness: { value: params.uniforms.metalness },
        toneMappingExposure: { value: 1.0 },
        previousModelViewMatrix: { value: new Matrix4() },
        sssColor: { value: new Color(0xff9a6b) },
        sssStrength: { value: 0 },
        sssPower: { value: 3 },
        sssDistortion: { value: 0.35 },
        sssDensity: { value: 14 },

        hasRoughnessMap: { value: params.uniforms.hasRoughnessMap },
        roughnessMap: { value: params.uniforms.roughnessMap },
        roughnessScale: { value: params.uniforms.roughnessScale ?? 1 },
        specularAA: { value: params.uniforms.specularAA ?? 1 },

        hasNormalMap: { value: params.uniforms.hasNormalMap },
        normalMap: { value: params.uniforms.normalMap },
        normalScale: {
          value: params.uniforms.normalScale ?? new Vector2(1, 1),
        },

        ambientLightColor: { value: new Color(0) },

        hemisphereLights: {
          value: [
            {
              direction: new Vector3(0, 1, 0),
              skyColor: new Color(0),
              groundColor: new Color(0),
            },
            {
              direction: new Vector3(0, 1, 0),
              skyColor: new Color(0),
              groundColor: new Color(0),
            },
          ],
        },

        hasEnvMap: { value: false },
        envMap: { value: null },
        envMapIntensity: { value: 1.0 },
        cubeUV_maxMip: { value: 8.0 },
        cubeUV_texelWidth: { value: 1.0 / 768.0 },
        cubeUV_texelHeight: { value: 1.0 / 1024.0 },

        directionalLights: {
          value: [
            { direction: new Vector3(0, 1, 0), color: new Color(0) },
            { direction: new Vector3(0, 1, 0), color: new Color(0) },
            { direction: new Vector3(0, 1, 0), color: new Color(0) },
            { direction: new Vector3(0, 1, 0), color: new Color(0) },
          ],
        },
        pointLights: {
          value: Array.from({ length: MAX_POINT_LIGHTS }, () => ({
            position: new Vector3(),
            color: new Color(0),
            distance: 0,
            decay: 2,
          })),
        },
        numDirectionalLights: { value: 0 },
        numHemisphereLights: { value: 0 },
        numPointLights: { value: 0 },
        ...params.customUniforms,
      },
      glslVersion: GLSL3,
    });
  }

  set envMap(texture) {
    const height = texture.height;

    const faceSize = height / 4;
    const cubeUV_maxMip = Math.log2(faceSize);

    const cubeUV_texelWidth = 1.0 / (3 * Math.pow(2, cubeUV_maxMip));
    const cubeUV_texelHeight = 1.0 / (4 * Math.pow(2, cubeUV_maxMip));

    this.uniforms.envMap.value = texture;
    this.uniforms.cubeUV_maxMip.value = cubeUV_maxMip;
    this.uniforms.cubeUV_texelWidth.value = cubeUV_texelWidth;
    this.uniforms.cubeUV_texelHeight.value = cubeUV_texelHeight;
    this.uniforms.hasEnvMap.value = true;
    this.needsUpdate = true;
  }

  syncLights(lights) {
    this.ambientLight = lights.ambient;
    this.directionalLights = lights.directional.slice(0, MAX_DIR_LIGHTS);
    this.pointLights = lights.point.slice(0, MAX_POINT_LIGHTS);

    const slots = this.uniforms.hemisphereLights.value;
    const count = Math.min(lights.hemisphere.length, slots.length);

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const light = i < count ? lights.hemisphere[i] : null;

      if (light) {
        slot.direction.copy(light.position).normalize();
        slot.skyColor.copy(light.color).multiplyScalar(light.intensity);
        slot.groundColor.copy(light.groundColor).multiplyScalar(light.intensity);
      } else {
        slot.direction.set(0, 1, 0);
        slot.skyColor.setScalar(0);
        slot.groundColor.setScalar(0);
      }
    }
    this.uniforms.numHemisphereLights.value = count;

    this.syncLightValues();
    this.syncPointLights();
  }

  syncLightValues() {
    if (this.ambientLight) {
      this.uniforms.ambientLightColor.value
        .copy(this.ambientLight.color)
        .multiplyScalar(this.ambientLight.intensity);
    }

    const slots = this.uniforms.directionalLights.value;
    const lights = this.directionalLights;
    if (!lights) return;

    for (let i = 0; i < lights.length; i++) {
      slots[i].direction.copy(lights[i].position).normalize();
      slots[i].color.copy(lights[i].color).multiplyScalar(lights[i].intensity);
    }
    this.uniforms.numDirectionalLights.value = lights.length;
  }

  syncPointLights() {
    const slots = this.uniforms.pointLights.value;
    const lights = this.pointLights;
    if (!lights) return;

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];
      const slot = slots[i];
      light.getWorldPosition(slot.position);
      slot.color.copy(light.color).multiplyScalar(light.intensity);
      slot.distance = light.distance;
      slot.decay = light.decay;
    }
    this.uniforms.numPointLights.value = lights.length;
  }

  syncRenderer(renderer) {
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
  }
}

export { Material, collectLights, loadEnvMap };
