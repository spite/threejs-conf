import {
  Mesh,
  RepeatWrapping,
  LinearMipmapLinearFilter,
} from "three";
import { effectRAF } from "reactive";
import { getFBO } from "modules/fbo.js";
import { makeLetterMaterial } from "modules/letterMaterial.js";
import { glyphSDF, createNormalMap } from "modules/stampTexture.js";
import { StampPass } from "modules/stampPass.js";
import { buildTextGeometry } from "modules/TextGeometry.js";
import { collectLights } from "modules/material.js";

function createLetters(ctx) {
  const { renderer, camera, scene, group, physics, font, params } = ctx;
  const { revision, rebuild, statBuild, tint, bgLight } = ctx;

  const MAP_SIZE = 512;

  let envMap = null;
  const letters = [];
  const letterTextures = [];
  let massBlendApplied = -1;
  const massBuffer = [];

  function disposeLetter(letter) {
    group.remove(letter);
    letter.geometry.dispose();
    letter.material.dispose();
  }

  function disposeSlot(slot) {
    slot.albedo.dispose();
    slot.normal.fbo.dispose();
    slot.normal.shader.dispose();
  }

  function getSlot(index) {
    let slot = letterTextures[index];
    if (slot) return slot;

    const albedo = getFBO(MAP_SIZE, MAP_SIZE, {
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
      depthBuffer: false,
      minFilter: LinearMipmapLinearFilter,
    });
    albedo.texture.generateMipmaps = true;
    albedo.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const normal = createNormalMap(renderer, albedo.texture);
    normal.setSize(MAP_SIZE, MAP_SIZE);
    normal.fbo.texture.wrapS = normal.fbo.texture.wrapT = RepeatWrapping;
    normal.fbo.texture.minFilter = LinearMipmapLinearFilter;
    normal.fbo.texture.generateMipmaps = true;
    normal.fbo.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    slot = { albedo, normal };
    letterTextures[index] = slot;
    return slot;
  }

  effectRAF(() => {
    rebuild();

    const t = performance.now();
    const built = buildTextGeometry(
      font,
      [params.line1.peek(), params.line2.peek()],
      {
        capHeight: params.capHeight.peek(),
        depth: params.depth.peek(),
        round: params.round.peek(),
        edge: params.edge.peek(),
        curveSteps: Math.round(params.curveSteps.peek()),
        resolution: Math.round(params.resolution.peek()),
        lineSpacing: params.lineSpacing.peek(),
        matchWidth: params.matchWidth.peek(),
        matchDepth: params.matchDepth.peek(),
        normalSmooth: params.normalSmooth.peek(),
      },
    );

    for (const letter of letters) disposeLetter(letter);
    letters.length = 0;
    physics.dispose();

    const lights = collectLights(scene);

    let tris = 0;
    for (const item of built.letters) {
      const letter = new Mesh(item.geometry, makeLetterMaterial(camera));
      letter.userData.char = item.char;
      letter.userData.line = item.line;
      letter.userData.home = item.center;
      letter.userData.texScale = 1 / (item.scale * built.fitScale);
      letter.position.set(item.center[0], item.center[1], item.center[2]);
      letter.userData.pieces = item.pieces;
      letter.userData.halfDepth = item.halfDepth;
      letter.userData.bodyRadius = item.geometry.boundingSphere
        ? item.geometry.boundingSphere.radius
        : 0.1;
      letter.userData.volume = Math.max(item.volume, 1e-6);
      letter.updateMatrixWorld(true);
      letter.material.uniforms.previousModelViewMatrix.value.multiplyMatrices(
        camera.matrixWorldInverse,
        letter.matrixWorld,
      );
      letter.material.syncLights(lights);
      letter.material.syncRenderer(renderer);
      if (envMap) letter.material.envMap = envMap;
      group.add(letter);
      letters.push(letter);
      tris += item.triangles;
    }

    let maxVolume = 1e-6;
    for (const letter of letters) {
      maxVolume = Math.max(maxVolume, letter.userData.volume);
    }

    const massBlend = params.massVariation.peek();

    for (const letter of letters) {
      const ratio = letter.userData.volume / maxVolume;
      letter.userData.volumeRatio = ratio;

      const shape = physics.makeShape(
        letter.userData.pieces,
        letter.userData.halfDepth,
        1,
      );
      physics.addBody(letter, shape, Math.pow(ratio, massBlend));
    }
    massBlendApplied = massBlend;

    tint.hue = NaN;
    revision.set(revision.peek() + 1);

    console.log(
      `text rebuilt: ${letters.length} letters (${built.meshed} glyphs meshed), ${tris} tris in ${Math.round(performance.now() - t)}ms`,
    );
    statBuild.sample(Math.round(performance.now() - t));
  });

  const stampPass = new StampPass(renderer);

  effectRAF(() => {
    revision();
    const stampOptions = {
      density: params.stampDensity(),
      size: params.stampSize(),
      opacity: params.stampOpacity(),
    };
    const seed = Math.round(params.seed());

    while (letterTextures.length > letters.length) {
      disposeSlot(letterTextures.pop());
    }

    const t = performance.now();
    let instances = 0;

    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];
      const slot = getSlot(i);
      const glyph = glyphSDF(font, letter.userData.char);
      instances += stampPass.paint(
        slot.albedo,
        glyph,
        seed + i * 0x9e3779b1,
        stampOptions,
      );
      slot.normal.render();

      const u = letter.material.uniforms;
      u.normalMap.value = slot.normal.fbo.texture;
      u.hasNormalMap.value = true;
      u.roughnessMap.value = slot.albedo.texture;
    }

    console.log(
      `letter maps rebuilt: ${letters.length} x ${MAP_SIZE}px, ${instances} stamps in ${Math.round(performance.now() - t)}ms`,
    );
  });

  function updateLetterMaterials(hue) {
    const spread = params.hueSpread();
    const sat = params.saturation();
    const lightness = params.lightness();
    const n = Math.max(letters.length, 1);
    const wireframe = params.wireframe();
    const roughness = params.roughness();
    const stampRoughness = params.stampRoughness();
    const metalness = params.metalness();
    const texScale = params.texScale();
    const blendSharpness = params.blendSharpness();
    const normalStrength = params.normalStrength();
    const specularAA = params.specularAA();
    const envMapIntensity = params.envMapIntensity();
    const sss = params.sss();
    const sssPower = params.sssPower();
    const sssDistortion = params.sssDistortion();
    const sssDensity = params.sssDensity();
    const rimStrength = params.rim();
    const rimPower = params.rimPower();

    const tintDirty =
      hue !== tint.hue ||
      spread !== tint.spread ||
      sat !== tint.sat ||
      lightness !== tint.light ||
      n !== tint.count;

    if (tintDirty) {
      tint.hue = hue;
      tint.spread = spread;
      tint.sat = sat;
      tint.light = lightness;
      tint.count = n;
    }

    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];
      if (letter.material.wireframe !== wireframe) {
        letter.material.wireframe = wireframe;
      }

      const u = letter.material.uniforms;
      if (tintDirty) {
        u.color.value.setHSL((hue + (spread * i) / n) % 1, sat, lightness);
        u.sssColor.value.setHSL((hue + 0.04) % 1, 0.85, 0.6);
      }
      u.roughness.value = roughness;
      u.hasRoughnessMap.value = stampRoughness !== 0;
      u.roughnessScale.value = stampRoughness;
      u.metalness.value = metalness;
      u.texScale.value = texScale * letter.userData.texScale;
      u.blendSharpness.value = blendSharpness;
      u.normalScale.value.setScalar(normalStrength);
      u.specularAA.value = specularAA;
      u.envMapIntensity.value = envMapIntensity;
      u.sssStrength.value = sss;
      u.sssPower.value = sssPower;
      u.sssDistortion.value = sssDistortion;
      u.sssDensity.value = sssDensity;
      u.rimColor.value.copy(bgLight);
      u.rimStrength.value = rimStrength;
      u.rimPower.value = rimPower;
    }
  }

  function syncMasses(massBlend) {
    if (massBlend === massBlendApplied || !letters.length) return;

    massBuffer.length = 0;
    for (const letter of letters) {
      massBuffer.push(Math.pow(letter.userData.volumeRatio, massBlend));
    }
    physics.setMasses(massBuffer);
    massBlendApplied = massBlend;
  }

  function setEnvMap(map) {
    envMap = map;
    for (const letter of letters) letter.material.envMap = map;
  }

  return {
    letters,
    updateMaterials: updateLetterMaterials,
    syncMasses,
    setEnvMap,
  };
}

export { createLetters };
