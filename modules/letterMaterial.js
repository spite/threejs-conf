import { Color, Vector2 } from "three";
import { Material } from "modules/material.js";
import { shader as main } from "shaders/letter.js";
import { shader as glow } from "shaders/glow.js";

function makeGlowMaterial(camera, color) {
  return new Material({
    main: glow,
    uniforms: { color: new Color(color), roughness: 1, metalness: 0 },
    customUniforms: {
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
    },
  });
}

function makeLetterMaterial(camera, color = 0xffffff) {
  return new Material({
    main,
    uniforms: {
      color: new Color(color),
      roughness: 0.2,
      metalness: 0.5,
      normalMap: null,
      hasNormalMap: false,
      normalScale: new Vector2(0.5, 0.5),
      roughnessMap: null,
      hasRoughnessMap: false,
      roughnessScale: 1,
      specularAA: 1,
    },
    customUniforms: {
      texScale: { value: 1 },
      blendSharpness: { value: 16 },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
      rimColor: { value: new Color(0x000000) },
      rimStrength: { value: 0 },
      rimPower: { value: 3 },
    },
  });
}

export { makeLetterMaterial, makeGlowMaterial };
