import { ShapeUtils, Vector2 } from "three";

function signedArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    a += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return 0.5 * a;
}

function bounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function isConvex(points) {
  let sign = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const c = points[(i + 2) % n];
    const cross =
      (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-12) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function groupContours(contours) {
  const solids = [];
  const holes = [];

  for (const c of contours) {
    if (c.length < 3) continue;
    const area = signedArea(c);
    if (Math.abs(area) < 1e-12) continue;
    const entry = { points: c, area: Math.abs(area), bounds: bounds(c) };
    if (area < 0) solids.push(entry);
    else holes.push(entry);
  }

  const groups = solids.map((s) => ({ outer: s.points, holes: [] }));

  for (const hole of holes) {
    let best = -1;
    let bestArea = Infinity;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      const p = hole.points[0];
      if (s.area < bestArea && pointInPolygon(p.x, p.y, s.points)) {
        best = i;
        bestArea = s.area;
      }
    }
    if (best >= 0) groups[best].holes.push(hole.points);
  }

  return groups;
}

function tryMerge(a, b, maxVerts) {
  for (let i = 0; i < a.length; i++) {
    const u = a[i];
    const v = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (b[j] !== v || b[(j + 1) % b.length] !== u) continue;

      const out = [];
      for (let k = 0; k <= i; k++) out.push(a[k]);
      for (let k = 2; k < b.length; k++) out.push(b[(j + k) % b.length]);
      for (let k = i + 1; k < a.length; k++) out.push(a[k]);

      if (out.length > maxVerts) return null;
      if (!isConvex(out)) return null;
      return out;
    }
  }
  return null;
}

function mergeTriangles(triangles, maxVerts) {
  const pieces = triangles.map((t) => t.slice());
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < pieces.length; i++) {
      if (!pieces[i]) continue;
      for (let j = i + 1; j < pieces.length; j++) {
        if (!pieces[j]) continue;
        const m = tryMerge(pieces[i], pieces[j], maxVerts);
        if (m) {
          pieces[i] = m;
          pieces[j] = null;
          changed = true;
        }
      }
    }
  }

  return pieces.filter(Boolean);
}

function convexPieces(profile, options = {}) {
  const merge = options.merge !== false;
  const maxVerts = options.maxVerts ?? 10;
  const groups = groupContours(profile.contours);
  const pieces = [];

  for (const group of groups) {
    const contour = group.outer.map((p) => new Vector2(p.x, p.y));
    const holes = group.holes.map((h) => h.map((p) => new Vector2(p.x, p.y)));

    const faces = ShapeUtils.triangulateShape(contour, holes);

    const verts = contour.concat(...holes);
    const tris = faces.map((f) => [verts[f[0]], verts[f[1]], verts[f[2]]]);
    const shaped = merge ? mergeTriangles(tris, maxVerts) : tris;

    for (const piece of shaped) {
      if (piece.length >= 3) pieces.push(piece);
    }
  }

  return pieces;
}

export { convexPieces };
