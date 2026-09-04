import { BufferAttribute } from "three";
import { MarchingCubesGeometry } from "modules/MarchingCubesGeometry.js";

const Z_BORDER = 8;
const MIN_Z = 8;
const XY_BORDER = 5;

class SDFMesher {
  constructor(resolution = 96, maxPolyCount = 200000) {
    this.normalSmooth = 0;
    this.geometry = new MarchingCubesGeometry(
      resolution,
      false,
      false,
      maxPolyCount,
    );
  }

  smoothGradients(size, radius) {
    const src = [this._gradX, this._gradY];
    if (!this._gradXS || this._gradXS.length !== size * size) {
      this._gradXS = new Float32Array(size * size);
      this._gradYS = new Float32Array(size * size);
      this._tmpX = new Float32Array(size * size);
      this._tmpY = new Float32Array(size * size);
    }
    const dstX = this._gradXS;
    const dstY = this._gradYS;
    const tmpX = this._tmpX;
    const tmpY = this._tmpY;
    const last = size - 1;
    const r = Math.max(1, Math.round(radius));

    for (let y = 0; y < size; y++) {
      const row = y * size;
      for (let x = 0; x < size; x++) {
        let sx = 0;
        let sy = 0;
        for (let k = -r; k <= r; k++) {
          const j = row + Math.min(Math.max(x + k, 0), last);
          sx += src[0][j];
          sy += src[1][j];
        }
        const n = 2 * r + 1;
        tmpX[row + x] = sx / n;
        tmpY[row + x] = sy / n;
      }
    }

    for (let y = 0; y < size; y++) {
      const row = y * size;
      for (let x = 0; x < size; x++) {
        let sx = 0;
        let sy = 0;
        for (let k = -r; k <= r; k++) {
          const j = Math.min(Math.max(y + k, 0), last) * size + x;
          sx += tmpX[j];
          sy += tmpY[j];
        }
        const n = 2 * r + 1;
        dstX[row + x] = sx / n;
        dstY[row + x] = sy / n;
      }
    }
  }

  setResolution(resolution) {
    this.resolution = resolution;
  }

  fitExtent(halfExtent) {
    const size = this.resolution ?? this.geometry.size;
    const usable = 1 - XY_BORDER / size;
    if (!halfExtent || usable <= 0) return 1;
    return Math.max(1, halfExtent / usable);
  }

  fitGrid(halfDepth, xyScale = 1) {
    const g = this.geometry;
    const size = this.resolution ?? g.size;
    const sizeZ = halfDepth
      ? Math.max(MIN_Z, Math.ceil((size * halfDepth) / xyScale) + Z_BORDER)
      : size;
    if (g.size !== size || g.sizeZ !== sizeZ) g.init(size, sizeZ);
    return (sizeZ * xyScale) / size;
  }

  updateExtruded(profile, extrude) {
    const xyScale = this.fitExtent(extrude.halfExtent);
    const zScale = this.fitGrid(extrude.halfDepth, xyScale);
    const g = this.geometry;
    const size = g.size;
    const sizeZ = g.sizeZ;
    const half = g.halfsize;
    const halfZ = g.halfsizeZ;

    g.reset();

    if (!this._profile || this._profile.length !== size * size) {
      this._profile = new Float32Array(size * size);
      this._gradX = new Float32Array(size * size);
      this._gradY = new Float32Array(size * size);
    }
    const d2 = this._profile;
    const gradX = this._gradX;
    const gradY = this._gradY;
    const sample = [0, 0, 0];

    for (let y = 0; y < size; y++) {
      const fy = ((y - half) / half) * xyScale;
      const ro = y * size;
      for (let x = 0; x < size; x++) {
        profile(((x - half) / half) * xyScale, fy, sample);
        d2[ro + x] = sample[0];
        gradX[ro + x] = sample[1];
        gradY[ro + x] = sample[2];
      }
    }

    for (let z = 0; z < sizeZ; z++) {
      const fz = ((z - halfZ) / halfZ) * zScale;
      const zo = g.size2 * z;
      for (let y = 0; y < size; y++) {
        const yo = zo + size * y;
        const ro = y * size;
        for (let x = 0; x < size; x++) {
          g.field[yo + x] = -extrude(d2[ro + x], fz);
        }
      }
    }

    if (this.normalSmooth > 0) {
      this.smoothGradients(size, 1 + this.normalSmooth * 2);
    }

    g.invalidated = true;
    const count = g.build();

    g.setDrawRange(0, count);

    if (zScale !== 1 || xyScale !== 1) {
      const pos = g.attributes.position.array;
      for (let i = 0; i < count * 3; i += 3) {
        pos[i] *= xyScale;
        pos[i + 1] *= xyScale;
        pos[i + 2] *= zScale;
      }
      g.attributes.position.needsUpdate = true;
    }

    if (extrude.grad) this.rebuildNormals(count, extrude, profile, xyScale);

    g.computeBoundingSphere();

    return count;
  }

  rebuildNormals(count, extrude, profile, xyScale = 1) {
    const g = this.geometry;
    const size = g.size;
    const half = g.halfsize;
    const gradX = this._gradX;
    const gradY = this._gradY;
    const smooth = this.normalSmooth;
    const gradXS = smooth > 0 ? this._gradXS : null;
    const gradYS = smooth > 0 ? this._gradYS : null;
    const pos = g.attributes.position.array;
    const nrm = g.attributes.normal.array;
    const last = size - 1;
    const exact = [0, 0, 0];

    const verts = pos.length / 3;
    if (!g.attributes.thickness || g.attributes.thickness.count !== verts) {
      g.setAttribute(
        "thickness",
        new BufferAttribute(new Float32Array(verts), 1),
      );
    }
    const thickness = g.attributes.thickness.array;
    const d2 = this._profile;

    for (let i = 0; i < count * 3; i += 3) {
      const gxf = Math.min(
        Math.max((pos[i] / xyScale) * half + half, 0),
        last,
      );
      const gyf = Math.min(
        Math.max((pos[i + 1] / xyScale) * half + half, 0),
        last,
      );
      const x0 = Math.min(gxf | 0, last - 1);
      const y0 = Math.min(gyf | 0, last - 1);
      const tx = gxf - x0;
      const ty = gyf - y0;

      const a = y0 * size + x0;
      const b = a + 1;
      const c = a + size;
      const e = c + 1;

      const w0 = (1 - tx) * (1 - ty);
      const w1 = tx * (1 - ty);
      const w2 = (1 - tx) * ty;
      const w3 = tx * ty;

      thickness[i / 3] = Math.max(
        0,
        -(d2[a] * w0 + d2[b] * w1 + d2[c] * w2 + d2[e] * w3),
      );

      let gx = gradX[a] * w0 + gradX[b] * w1 + gradX[c] * w2 + gradX[e] * w3;
      let gy = gradY[a] * w0 + gradY[b] * w1 + gradY[c] * w2 + gradY[e] * w3;
      const gl = Math.sqrt(gx * gx + gy * gy);
      if (gl < 0.9) {
        profile(pos[i], pos[i + 1], exact);
        gx = exact[1];
        gy = exact[2];
      } else {
        gx /= gl;
        gy /= gl;
      }

      if (gradXS) {
        const sx =
          gradXS[a] * w0 + gradXS[b] * w1 + gradXS[c] * w2 + gradXS[e] * w3;
        const sy =
          gradYS[a] * w0 + gradYS[b] * w1 + gradYS[c] * w2 + gradYS[e] * w3;
        const sl = Math.sqrt(sx * sx + sy * sy);
        if (sl > 0.25) {
          const mx = gx + (sx / sl - gx) * smooth;
          const my = gy + (sy / sl - gy) * smooth;
          const ml = Math.sqrt(mx * mx + my * my);
          if (ml > 1e-6) {
            gx = mx / ml;
            gy = my / ml;
          }
        }
      }

      const n = extrude.grad(pos[i + 2], gx, gy);
      let nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
      if (nl > 1e-9) {
        nrm[i] = n[0] / nl;
        nrm[i + 1] = n[1] / nl;
        nrm[i + 2] = n[2] / nl;
      } else {
        nl =
          Math.sqrt(
            nrm[i] * nrm[i] + nrm[i + 1] * nrm[i + 1] + nrm[i + 2] * nrm[i + 2],
          ) || 1;
        nrm[i] /= nl;
        nrm[i + 1] /= nl;
        nrm[i + 2] /= nl;
      }
    }

    g.attributes.normal.needsUpdate = true;
    g.attributes.thickness.needsUpdate = true;
  }

  update(sdf) {
    const g = this.geometry;
    const size = g.size;
    const half = g.halfsize;

    g.reset();

    for (let z = 0; z < size; z++) {
      const fz = (z - half) / half;
      const zo = g.size2 * z;
      for (let y = 0; y < size; y++) {
        const fy = (y - half) / half;
        const yo = zo + size * y;
        for (let x = 0; x < size; x++) {
          const fx = (x - half) / half;
          g.field[yo + x] = -sdf(fx, fy, fz);
        }
      }
    }

    if (this.normalSmooth > 0) {
      this.smoothGradients(size, 1 + this.normalSmooth * 2);
    }

    g.invalidated = true;
    const count = g.build();

    g.setDrawRange(0, count);
    g.computeBoundingSphere();

    return count;
  }
}

export { SDFMesher };
