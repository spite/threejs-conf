function extrudeRound(d2, z, halfDepth, r) {
  const wx = d2 + r;
  const wy = Math.abs(z) - (halfDepth - r);
  const mx = Math.max(wx, 0);
  const my = Math.max(wy, 0);
  return Math.min(Math.max(wx, wy), 0) + Math.sqrt(mx * mx + my * my) - r;
}

function surfaceBand(z, halfDepth, r) {
  const az = Math.abs(z);
  if (r <= 1e-9) return az >= halfDepth - 1e-6 ? 1 : -1;
  const wy = az - (halfDepth - r);
  const tol = Math.max(r * 1e-4, 1e-7);
  if (wy <= tol) return -1;
  if (wy >= r - tol) return 1;
  return wy / r;
}

function extrudeRoundGrad(z, halfDepth, r, gx, gy) {
  const band = surfaceBand(z, halfDepth, r);
  const sz = z >= 0 ? 1 : -1;
  if (band === -1) return [gx, gy, 0];
  if (band === 1) return [0, 0, sz];
  const b = band;
  const a = Math.sqrt(Math.max(1 - b * b, 0));
  return [a * gx, a * gy, b * sz];
}

function extrudeChamferGrad(z, halfDepth, r, gx, gy) {
  const band = surfaceBand(z, halfDepth, r);
  const sz = z >= 0 ? 1 : -1;
  if (band === -1) return [gx, gy, 0];
  if (band === 1) return [0, 0, sz];
  const s = Math.SQRT1_2;
  return [s * gx, s * gy, s * sz];
}

function extrudeChamfer(d2, z, halfDepth, r) {
  const a = d2;
  const b = Math.abs(z) - halfDepth;
  return Math.max(Math.max(a, b), (a + b + r) * Math.SQRT1_2);
}

export {
  extrudeRound,
  extrudeChamfer,
  extrudeRoundGrad,
  extrudeChamferGrad,
};
