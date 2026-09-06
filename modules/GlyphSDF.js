import { parse } from "opentype";
import {
  extrudeRound,
  extrudeChamfer,
  extrudeRoundGrad,
  extrudeChamferGrad,
} from "modules/LetterSDF.js";

async function loadFont(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not load font ${url}: ${response.status}`);
  }
  return parse(await response.arrayBuffer());
}

function flattenCommands(commands, steps) {
  const contours = [];
  let current = null;
  let cx = 0;
  let cy = 0;

  const moveTo = (x, y) => {
    if (current && current.length >= 6) contours.push(current);
    current = [x, y];
    cx = x;
    cy = y;
  };
  const lineTo = (x, y) => {
    if (!current) return;
    current.push(x, y);
    cx = x;
    cy = y;
  };

  for (const c of commands) {
    if (c.type === "M") {
      moveTo(c.x, -c.y);
    } else if (c.type === "L") {
      lineTo(c.x, -c.y);
    } else if (c.type === "Q") {
      const x0 = cx;
      const y0 = cy;
      const x1 = c.x1;
      const y1 = -c.y1;
      const x2 = c.x;
      const y2 = -c.y;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        lineTo(
          u * u * x0 + 2 * u * t * x1 + t * t * x2,
          u * u * y0 + 2 * u * t * y1 + t * t * y2,
        );
      }
    } else if (c.type === "C") {
      const x0 = cx;
      const y0 = cy;
      const x1 = c.x1;
      const y1 = -c.y1;
      const x2 = c.x2;
      const y2 = -c.y2;
      const x3 = c.x;
      const y3 = -c.y;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        lineTo(
          u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        );
      }
    } else if (c.type === "Z") {
      if (current && current.length >= 6) contours.push(current);
      current = null;
    }
  }
  if (current && current.length >= 6) contours.push(current);
  return contours;
}

const glyphDefaults = {
  capHeight: 1.4,
  curveSteps: 10,
};

class GlyphProfile {
  constructor(font, char, options = {}) {
    const o = { ...glyphDefaults, ...options };
    const glyph = font.charToGlyph(char);
    const contours = flattenCommands(
      glyph.getPath(0, 0, font.unitsPerEm).commands,
      Math.max(1, Math.round(o.curveSteps)),
    );

    const unitCap =
      (font.tables.os2 && font.tables.os2.sCapHeight) || font.ascender;
    const scale = o.capHeight / unitCap;

    let minX = Infinity;
    let maxX = -Infinity;
    for (const c of contours) {
      for (let i = 0; i < c.length; i += 2) {
        if (c[i] < minX) minX = c[i];
        if (c[i] > maxX) maxX = c[i];
      }
    }
    const offsetX = -0.5 * (minX + maxX);
    const offsetY = -0.5 * unitCap;

    this.char = char;
    this.contours = [];
    for (const c of contours) {
      const out = [];
      for (let i = 0; i < c.length; i += 2) {
        const x = (c[i] + offsetX) * scale;
        const y = (c[i + 1] + offsetY) * scale;
        const prev = out[out.length - 1];
        if (prev) {
          const dx = x - prev.x;
          const dy = y - prev.y;
          if (dx * dx + dy * dy < 1e-14) continue;
        }
        out.push({ x, y });
      }
      while (out.length > 1) {
        const a = out[0];
        const b = out[out.length - 1];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy >= 1e-14) break;
        out.pop();
      }
      if (out.length >= 3) this.contours.push(out);
    }
    this.offsetX = offsetX;
    this.unitScale = scale;
    this.unitCap = unitCap;

    let halfExtent = 0;
    for (const c of this.contours) {
      for (const p of c) {
        const e = Math.max(Math.abs(p.x), Math.abs(p.y));
        if (e > halfExtent) halfExtent = e;
      }
    }
    this.halfExtent = halfExtent;

    const raw = [];
    for (const c of contours) {
      const n = c.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = (c[i * 2] + offsetX) * scale;
        const ay = (c[i * 2 + 1] + offsetY) * scale;
        const bx = (c[j * 2] + offsetX) * scale;
        const by = (c[j * 2 + 1] + offsetY) * scale;
        const ex = bx - ax;
        const ey = by - ay;
        if (ex * ex + ey * ey < 1e-14) continue;
        raw.push(ax, ay, bx, by);
      }
    }
    this.raw = new Float32Array(raw);
    this.rawCount = this.raw.length;

    const maxPiece = 0.012;
    const eps = 2e-3;
    const seg = [];
    const nrm = [];
    const corner = [];

    for (let i = 0; i < this.rawCount; i += 4) {
      const ax = this.raw[i];
      const ay = this.raw[i + 1];
      const ex = this.raw[i + 2] - ax;
      const ey = this.raw[i + 3] - ay;
      const len = Math.sqrt(ex * ex + ey * ey);
      const steps = Math.max(1, Math.ceil(len / maxPiece));
      const px = -ey / len;
      const py = ex / len;

      for (let k = 0; k < steps; k++) {
        const t0 = k / steps;
        const t1 = (k + 1) / steps;
        const sx = ax + ex * t0;
        const sy = ay + ey * t0;
        const tx = ax + ex * t1;
        const ty = ay + ey * t1;
        const mx = 0.5 * (sx + tx);
        const my = 0.5 * (sy + ty);
        const inPos = this.windingInside(mx + eps * px, my + eps * py);
        const inNeg = this.windingInside(mx - eps * px, my - eps * py);
        if (inPos === inNeg) continue;
        const sgn = inPos ? -1 : 1;
        seg.push(sx, sy, tx, ty);
        nrm.push(sgn * px, sgn * py);
        corner.push(k === 0 ? 1 : 0, k === steps - 1 ? 1 : 0);
      }
    }

    this.segments = new Float32Array(seg);
    this.normals = new Float32Array(nrm);
    this.corners = new Uint8Array(corner);
    this.count = this.segments.length;
    this.segCount = this.count / 4;

    let bMinX = Infinity;
    let bMaxX = -Infinity;
    let bMinY = Infinity;
    let bMaxY = -Infinity;
    for (let i = 0; i < this.rawCount; i += 2) {
      if (this.raw[i] < bMinX) bMinX = this.raw[i];
      if (this.raw[i] > bMaxX) bMaxX = this.raw[i];
      if (this.raw[i + 1] < bMinY) bMinY = this.raw[i + 1];
      if (this.raw[i + 1] > bMaxY) bMaxY = this.raw[i + 1];
    }
    this.bounds = { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY };

    const probe = 72;
    const depths = [];
    for (let j = 0; j < probe; j++) {
      const y = bMinY + ((bMaxY - bMinY) * j) / (probe - 1);
      for (let i = 0; i < probe; i++) {
        const x = bMinX + ((bMaxX - bMinX) * i) / (probe - 1);
        const d = -this.distance(x, y);
        if (d > 0) depths.push(d);
      }
    }
    depths.sort((a, b) => a - b);
    this.thickness = depths.length
      ? Math.max(depths[Math.floor(0.25 * (depths.length - 1))], 1e-3)
      : 1e-3;
  }

  windingInside(px, py) {
    const s = this.raw;
    const n = this.rawCount;
    let wn = 0;
    for (let i = 0; i < n; i += 4) {
      const ax = s[i];
      const ay = s[i + 1];
      const ex = s[i + 2] - ax;
      const ey = s[i + 3] - ay;
      const side = ex * (py - ay) - (px - ax) * ey;
      if (ay <= py) {
        if (s[i + 3] > py && side > 0) wn++;
      } else if (s[i + 3] <= py && side < 0) wn--;
    }
    return wn !== 0;
  }

  distance(px, py) {
    const s = this.segments;
    const n = this.count;
    let best = Infinity;
    for (let i = 0; i < n; i += 4) {
      const ax = s[i];
      const ay = s[i + 1];
      const ex = s[i + 2] - ax;
      const ey = s[i + 3] - ay;
      const wx = px - ax;
      const wy = py - ay;
      const len = ex * ex + ey * ey;
      let t = len > 0 ? (wx * ex + wy * ey) / len : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = wx - ex * t;
      const dy = wy - ey * t;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return (this.windingInside(px, py) ? -1 : 1) * Math.sqrt(best);
  }

  distanceGradient(px, py, out) {
    const s = this.segments;
    const n = this.count;
    let best = Infinity;
    let bx = 0;
    let by = 0;
    let bi = 0;
    let bt = 0;

    for (let i = 0; i < n; i += 4) {
      const ax = s[i];
      const ay = s[i + 1];
      const ex = s[i + 2] - ax;
      const ey = s[i + 3] - ay;
      const wx = px - ax;
      const wy = py - ay;
      const len = ex * ex + ey * ey;
      let t = len > 0 ? (wx * ex + wy * ey) / len : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = wx - ex * t;
      const dy = wy - ey * t;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        bx = dx;
        by = dy;
        bi = i >> 2;
        bt = t;
      }
    }

    const sign = this.windingInside(px, py) ? -1 : 1;
    const dist = Math.sqrt(best);

    if (sign < 0 && dist > 1e-9) {
      const atStart = bt <= 0 && this.corners[bi * 2] === 1;
      const atEnd = bt >= 1 && this.corners[bi * 2 + 1] === 1;
      if (atStart || atEnd) {
        const nx = this.normals[bi * 2];
        const ny = this.normals[bi * 2 + 1];
        const dSelf = (px - s[bi * 4]) * nx + (py - s[bi * 4 + 1]) * ny;
        let bestMiter = dSelf;
        let mx = nx;
        let my = ny;
        const vx = atEnd ? s[bi * 4 + 2] : s[bi * 4];
        const vy = atEnd ? s[bi * 4 + 3] : s[bi * 4 + 1];
        for (let k = 0; k < n; k += 4) {
          const j = k >> 2;
          if (j === bi) continue;
          const sameStart =
            Math.abs(s[k] - vx) < 1e-6 && Math.abs(s[k + 1] - vy) < 1e-6;
          const sameEnd =
            Math.abs(s[k + 2] - vx) < 1e-6 && Math.abs(s[k + 3] - vy) < 1e-6;
          if (!sameStart && !sameEnd) continue;
          const jn = this.normals[j * 2];
          const jm = this.normals[j * 2 + 1];
          const dj = (px - s[k]) * jn + (py - s[k + 1]) * jm;
          if (dj < bestMiter) {
            bestMiter = dj;
            mx = jn;
            my = jm;
          }
        }
        if (bestMiter < 0 && (mx * bx + my * by) < 0) {
          out[0] = sign * dist;
          out[1] = mx;
          out[2] = my;
          return out;
        }
      }
    }

    const inv = dist > 1e-9 ? sign / dist : 0;
    out[0] = sign * dist;
    out[1] = bx * inv;
    out[2] = by * inv;
    return out;
  }

  roundLimit(halfDepth) {
    return Math.min(halfDepth, this.thickness);
  }

  extruded(halfDepth, round, edge = "round") {
    const t = Math.max(0, Math.min(round, 1));
    const r = t * this.roundLimit(halfDepth);
    if (edge === "bevel") {
      const f = (d2, z) => extrudeChamfer(d2, z, halfDepth, r);
      f.grad = (z, gx, gy) => extrudeChamferGrad(z, halfDepth, r, gx, gy);
      f.halfDepth = halfDepth;
      f.halfExtent = this.halfExtent;
      return f;
    }
    const f = (d2, z) => extrudeRound(d2, z, halfDepth, r);
    f.grad = (z, gx, gy) => extrudeRoundGrad(z, halfDepth, r, gx, gy);
    f.halfDepth = halfDepth;
    f.halfExtent = this.halfExtent;
    return f;
  }
}

export { loadFont, GlyphProfile };
