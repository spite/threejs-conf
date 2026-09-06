import {
  RawShaderMaterial,
  GLSL3,
  DataTexture,
  RedFormat,
  LinearFilter,
} from "three";
import Maf from "maf";
import { ShaderTexture } from "modules/ShaderTexture.js";
import { shader as normalMapVs } from "shaders/normalMapVs.js";
import { shader as normalMapFs } from "shaders/normalMapFs.js";
import { GlyphProfile } from "modules/GlyphSDF.js";

const SDF_SIZE = 64;
const SDF_PAD = 1.3;
const SDF_RANGE = 0.25;
const POISSON_PACKING = 0.6136;
const POISSON_TRIES = 20;
const poissonCache = new Map();
const STAMPS_PER_AREA = 4630 / (512 * 512);
const DENSITY_STEP = 256;
const DENSITY_MAX = 16384;
const sdfCache = new WeakMap();

function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function glyphSDF(font, char) {
  let byChar = sdfCache.get(font);
  if (!byChar) {
    byChar = new Map();
    sdfCache.set(font, byChar);
  }

  const cached = byChar.get(char);
  if (cached) return cached;

  if (font.charToGlyph(char).index <= 0) {
    const blank = { texture: null, extent: 0, unitCap: 0, empty: true };
    byChar.set(char, blank);
    return blank;
  }

  const profile = new GlyphProfile(font, char, { capHeight: 1, curveSteps: 6 });
  const extent = profile.halfExtent * SDF_PAD;
  const data = new Uint8Array(SDF_SIZE * SDF_SIZE);

  for (let y = 0; y < SDF_SIZE; y++) {
    const fy = (((y + 0.5) / SDF_SIZE) * 2 - 1) * extent;
    for (let x = 0; x < SDF_SIZE; x++) {
      const fx = (((x + 0.5) / SDF_SIZE) * 2 - 1) * extent;
      const d = profile.distance(fx, fy) / (extent * SDF_RANGE);
      const v = Math.round(255 * (0.5 - 0.5 * d));
      data[y * SDF_SIZE + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }

  const texture = new DataTexture(data, SDF_SIZE, SDF_SIZE, RedFormat);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const entry = {
    texture,
    extent,
    unitCap: profile.unitCap / font.unitsPerEm,
    empty: false,
  };
  byChar.set(char, entry);
  return entry;
}

function poissonDisk(size, count, rng) {
  const radius = size * Math.sqrt(POISSON_PACKING / Math.max(count, 1));
  const cell = radius / Math.SQRT2;
  const cols = Math.max(1, Math.ceil(size / cell));
  const grid = new Int32Array(cols * cols).fill(-1);
  const points = [];
  const active = [];

  const wrap = (v) => ((v % size) + size) % size;
  const at = (cx, cy) => grid[((cy % cols) + cols) % cols * cols + (((cx % cols) + cols) % cols)];

  const fits = (x, y) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const k = at(cx + i, cy + j);
        if (k < 0) continue;
        let dx = Math.abs(points[k * 2] - x);
        let dy = Math.abs(points[k * 2 + 1] - y);
        if (dx > size * 0.5) dx = size - dx;
        if (dy > size * 0.5) dy = size - dy;
        if (dx * dx + dy * dy < radius * radius) return false;
      }
    }
    return true;
  };

  const add = (x, y) => {
    const index = points.length / 2;
    points.push(x, y);
    active.push(index);
    grid[Math.floor(y / cell) * cols + Math.floor(x / cell)] = index;
  };

  add(rng() * size, rng() * size);

  while (active.length) {
    const pick = Math.floor(rng() * active.length);
    const index = active[pick];
    let placed = false;

    for (let tries = 0; tries < POISSON_TRIES; tries++) {
      const angle = rng() * Maf.TAU;
      const dist = radius * (1 + rng());
      const x = wrap(points[index * 2] + Math.cos(angle) * dist);
      const y = wrap(points[index * 2 + 1] + Math.sin(angle) * dist);
      if (!fits(x, y)) continue;
      add(x, y);
      placed = true;
      break;
    }

    if (!placed) {
      active[pick] = active[active.length - 1];
      active.pop();
    }
  }

  return points;
}

function stampCount(size, density) {
  const raw = density * size * size * STAMPS_PER_AREA;
  const stepped = Math.round(raw / DENSITY_STEP) * DENSITY_STEP;
  return Math.min(stepped, DENSITY_MAX);
}

function poissonPoints(size, count) {
  const key = `${size}:${count}`;
  let points = poissonCache.get(key);
  if (!points) {
    points = poissonDisk(size, count, makeRandom(0x9e3779b1));
    poissonCache.set(key, points);
  }
  return points;
}

function stampInstances(glyph, seed, size, options, out) {
  if (glyph.empty) return 0;

  const rng = makeRandom(seed);
  const range = (min, max) => min + rng() * (max - min);
  const unit = (size / 16) * glyph.unitCap;
  let n = 0;

  const spots = poissonPoints(size, stampCount(size, options.density));
  const offsetX = rng() * size;
  const offsetY = rng() * size;
  const symmetry = Math.floor(rng() * 8);

  for (let i = 0; i < spots.length / 2; i++) {
    let sx = spots[i * 2];
    let sy = spots[i * 2 + 1];
    if (symmetry & 1) sx = size - sx;
    if (symmetry & 2) sy = size - sy;
    if (symmetry & 4) {
      const swap = sx;
      sx = sy;
      sy = swap;
    }
    const posX = (sx + offsetX) % size;
    const posY = (sy + offsetY) % size;
    const rot = range(0, Maf.TAU);
    const s = range(options.size[0], options.size[1]);
    const side = 2 * glyph.extent * unit * s;
    const radius = 0.5 * side;
    const alpha = range(0.15, 0.6) * options.opacity;

    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        const px = posX + x * size;
        const py = posY + y * size;
        if (px + radius < 0 || px - radius > size) continue;
        if (py + radius < 0 || py - radius > size) continue;

        const o = n * 5;
        if (o + 5 > out.length) {
          console.warn(
            `stamp buffer full at ${n} instances; raise the StampPass capacity`,
          );
          return n;
        }
        out[o] = px;
        out[o + 1] = py;
        out[o + 2] = rot;
        out[o + 3] = side;
        out[o + 4] = alpha;
        n++;
      }
    }
  }

  return n;
}

function createNormalMap(renderer, albedo) {
  const shader = new RawShaderMaterial({
    uniforms: {
      depth: { value: albedo },
    },
    vertexShader: normalMapVs,
    fragmentShader: normalMapFs,
    glslVersion: GLSL3,
  });
  return new ShaderTexture(renderer, shader, 1, 1);
}

export { glyphSDF, stampInstances, createNormalMap };
