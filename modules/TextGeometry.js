import { BufferAttribute, BufferGeometry } from "three";
import { GlyphProfile } from "modules/GlyphSDF.js";
import { SDFMesher } from "modules/sdfMesher.js";
import { convexPieces } from "modules/ConvexPieces.js";

const textDefaults = {
  capHeight: 1.4,
  depth: 0.32,
  round: 1,
  edge: "round",
  curveSteps: 10,
  resolution: 72,
  lineSpacing: 1.15,
  matchWidth: true,
  matchDepth: false,
  recenter: true,
  colliderSteps: 2,
  normalSmooth: 0,
  fit: 0.92,
};

function layoutLine(font, text) {
  const glyphs = [];
  let pen = 0;
  let prev = null;
  let inkMin = Infinity;
  let inkMax = -Infinity;

  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    if (prev) pen += font.getKerningValue(prev, glyph);
    if (glyph.index > 0 && ch !== " ") {
      const bb = glyph.getBoundingBox();
      if (isFinite(bb.x1) && bb.x2 > bb.x1) {
        inkMin = Math.min(inkMin, pen + bb.x1);
        inkMax = Math.max(inkMax, pen + bb.x2);
      }
      glyphs.push({ char: ch, pen });
    }
    pen += glyph.advanceWidth;
    prev = glyph;
  }

  if (!isFinite(inkMin)) {
    inkMin = 0;
    inkMax = 0;
  }

  return {
    glyphs,
    width: pen,
    inkWidth: inkMax - inkMin,
    inkCenter: 0.5 * (inkMin + inkMax),
  };
}

let sharedMesher = null;

function getMesher(resolution) {
  if (!sharedMesher || sharedMesher.geometry.size !== resolution) {
    sharedMesher = new SDFMesher(resolution);
  }
  return sharedMesher;
}

function meshGlyphs(font, laid, target, o, mesher) {
  const cache = new Map();
  const chunks = [];
  let meshed = 0;

  let baseline = 0;
  for (let i = 0; i < laid.length; i++) {
    const line = laid[i];
    const scale =
      o.matchWidth && line.inkWidth > 0 ? target / line.inkWidth : 1;
    if (i > 0) baseline -= o.lineSpacing * o.capHeight * scale;

    const lineDepth = o.matchDepth && scale > 0 ? o.depth / scale : o.depth;

    for (const placed of line.glyphs) {
      const key = `${placed.char}:${lineDepth.toFixed(6)}`;
      let entry = cache.get(key);
      if (!entry) {
        const profile = new GlyphProfile(font, placed.char, {
          capHeight: o.capHeight,
          curveSteps: o.curveSteps,
        });
        const halfDepth = 0.5 * lineDepth;
        const lineLimit = profile.roundLimit(halfDepth);
        const lineRound = o.matchDepth
          ? Math.min(
              1,
              (o.round * profile.roundLimit(0.5 * o.depth)) /
                (scale * (lineLimit || 1)),
            )
          : o.round;
        const extrude = profile.extruded(halfDepth, lineRound, o.edge);
        const count = mesher.updateExtruded(
          (x, y, out) => profile.distanceGradient(x, y, out),
          extrude,
        );
        entry = {
          profile,
          pieces: convexPieces(
            new GlyphProfile(font, placed.char, {
              capHeight: o.capHeight,
              curveSteps: Math.max(2, Math.round(o.colliderSteps)),
            }),
            { merge: true },
          ),
          radius: lineLimit * lineRound,
          count,
          pos: mesher.geometry.attributes.position.array.slice(0, count * 3),
          nrm: mesher.geometry.attributes.normal.array.slice(0, count * 3),
          thk: mesher.geometry.attributes.thickness.array.slice(0, count),
        };
        cache.set(key, entry);
        meshed++;
      }

      const g = entry.profile;
      const centre = placed.pen - g.offsetX;
      const tx = (centre - line.inkCenter) * scale * g.unitScale;
      const ty = baseline + 0.5 * o.capHeight * scale;

      const count = entry.count;
      const pos = new Float32Array(count * 3);
      const nrm = new Float32Array(count * 3);
      const thk = new Float32Array(count);
      for (let k = 0; k < count; k++) thk[k] = entry.thk[k] * scale;

      for (let k = 0; k < count * 3; k += 3) {
        pos[k] = entry.pos[k] * scale + tx;
        pos[k + 1] = entry.pos[k + 1] * scale + ty;
        pos[k + 2] = entry.pos[k + 2] * scale;

        nrm[k] = entry.nrm[k];
        nrm[k + 1] = entry.nrm[k + 1];
        nrm[k + 2] = entry.nrm[k + 2];
      }

      chunks.push({
        char: placed.char,
        line: i,
        pos,
        nrm,
        thk,
        count,
        scale,
        round: entry.radius * scale,
        pieces: entry.pieces,
        tx,
        ty,
        halfDepth: 0.5 * lineDepth * scale,
      });
    }
  }

  return { chunks, meshed };
}

function fitBounds(chunks, fit) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of chunks) {
    for (let i = 0; i < c.pos.length; i += 3) {
      if (c.pos[i] < minX) minX = c.pos[i];
      if (c.pos[i] > maxX) maxX = c.pos[i];
      if (c.pos[i + 1] < minY) minY = c.pos[i + 1];
      if (c.pos[i + 1] > maxY) maxY = c.pos[i + 1];
    }
  }

  const span = Math.max(maxX - minX, maxY - minY);

  return {
    cx: 0.5 * (minX + maxX),
    cy: 0.5 * (minY + maxY),
    k: span > 0 ? (2 * fit) / span : 1,
  };
}

function buildLetters(chunks, cx, cy, k, recenter) {
  const letters = [];
  for (const c of chunks) {
    let lx = 0;
    let ly = 0;
    let lz = 0;
    let n = 0;
    for (let i = 0; i < c.pos.length; i += 3) {
      c.pos[i] = (c.pos[i] - cx) * k;
      c.pos[i + 1] = (c.pos[i + 1] - cy) * k;
      c.pos[i + 2] *= k;
      lx += c.pos[i];
      ly += c.pos[i + 1];
      lz += c.pos[i + 2];
      n++;
    }

    const cxL = lx / n;
    const cyL = ly / n;
    const czL = lz / n;
    if (recenter) {
      for (let i = 0; i < c.pos.length; i += 3) {
        c.pos[i] -= cxL;
        c.pos[i + 1] -= cyL;
        c.pos[i + 2] -= czL;
      }
    }
    for (let i = 0; i < c.thk.length; i++) c.thk[i] *= k;

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(c.pos, 3));
    geometry.setAttribute("normal", new BufferAttribute(c.nrm, 3));
    geometry.setAttribute("thickness", new BufferAttribute(c.thk, 1));
    geometry.computeBoundingSphere();

    const shift = recenter ? 1 : 0;
    const pieces = c.pieces.map((piece) =>
      piece.map((p) => ({
        x: (p.x * c.scale + c.tx - cx) * k - cxL * shift,
        y: (p.y * c.scale + c.ty - cy) * k - cyL * shift,
      })),
    );

    let area = 0;
    for (const piece of pieces) {
      let a = 0;
      for (let i = 0; i < piece.length; i++) {
        const j = (i + 1) % piece.length;
        a += piece[i].x * piece[j].y - piece[j].x * piece[i].y;
      }
      area += Math.abs(a) * 0.5;
    }

    letters.push({
      char: c.char,
      line: c.line,
      scale: c.scale,
      round: c.round,
      pieces,
      halfDepth: c.halfDepth * k,
      volume: area * 2 * c.halfDepth * k,
      geometry,
      triangles: c.count / 3,
      center: [cxL, cyL, czL],
    });
  }

  return letters;
}

function buildTextGeometry(font, lines, options = {}) {
  const o = { ...textDefaults, ...options };
  const mesher = getMesher(Math.round(o.resolution));
  mesher.normalSmooth = o.normalSmooth ?? 0;

  const laid = lines.map((text) => layoutLine(font, text));
  const target = Math.max(...laid.map((l) => l.inkWidth));

  const { chunks, meshed } = meshGlyphs(font, laid, target, o, mesher);
  const { cx, cy, k } = fitBounds(chunks, o.fit);

  return {
    letters: buildLetters(chunks, cx, cy, k, o.recenter),
    meshed,
    lineWidths: laid.map((l) => l.inkWidth),
    lineScales: laid.map((l) =>
      o.matchWidth && l.inkWidth > 0 ? target / l.inkWidth : 1,
    ),
    fitScale: k,
  };
}

export { buildTextGeometry };