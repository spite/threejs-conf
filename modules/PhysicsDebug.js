import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Quaternion,
  Scene,
  Vector3,
} from "three";

const COLLIDER = [0.2, 0.9, 1.0];
const VELOCITY = [0.3, 1.0, 0.4];
const SPIN = [1.0, 0.35, 0.9];
const FORCE = [1.0, 0.6, 0.15];
const CONTACT = [1.0, 0.2, 0.2];
const HOME = [0.45, 0.5, 0.65];

class PhysicsDebug {
  constructor(maxVertices = 8000) {
    this.positions = new Float32Array(maxVertices * 3);
    this.colors = new Float32Array(maxVertices * 3);
    this.max = maxVertices;
    this.count = 0;

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new BufferAttribute(this.colors, 3));
    geometry.setDrawRange(0, 0);
    this.geometry = geometry;

    this.material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });

    this.lines = new LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.matrixAutoUpdate = false;

    this.scene = new Scene();
    this.scene.add(this.lines);

    this.quaternion = new Quaternion();
    this.point = new Vector3();
  }

  segment(ax, ay, az, bx, by, bz, color) {
    if (this.count + 2 > this.max) return;
    const p = this.positions;
    const c = this.colors;
    let i = this.count * 3;

    p[i] = ax;
    p[i + 1] = ay;
    p[i + 2] = az;
    c[i] = color[0];
    c[i + 1] = color[1];
    c[i + 2] = color[2];

    i += 3;
    p[i] = bx;
    p[i + 1] = by;
    p[i + 2] = bz;
    c[i] = color[0];
    c[i + 1] = color[1];
    c[i + 2] = color[2];

    this.count += 2;
  }

  arrow(ox, oy, oz, vx, vy, vz, color) {
    const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (len < 1e-5) return;
    const ex = ox + vx;
    const ey = oy + vy;
    const ez = oz + vz;
    this.segment(ox, oy, oz, ex, ey, ez, color);

    const head = Math.min(len * 0.25, 0.05);
    const nx = vx / len;
    const ny = vy / len;
    const nz = vz / len;

    let px = -ny;
    let py = nx;
    const pl = Math.hypot(px, py);
    if (pl < 1e-5) {
      px = 1;
      py = 0;
    } else {
      px /= pl;
      py /= pl;
    }
    const pz = 0;
    this.segment(
      ex,
      ey,
      ez,
      ex - nx * head + px * head * 0.5,
      ey - ny * head + py * head * 0.5,
      ez - nz * head + pz * head * 0.5,
      color,
    );
    this.segment(
      ex,
      ey,
      ez,
      ex - nx * head - px * head * 0.5,
      ey - ny * head - py * head * 0.5,
      ez - nz * head - pz * head * 0.5,
      color,
    );
  }

  cross(x, y, z, size, color) {
    this.segment(x - size, y, z, x + size, y, z, color);
    this.segment(x, y - size, z, x, y + size, z, color);
    this.segment(x, y, z - size, x, y, z + size, color);
  }

  collider(letter) {
    const pieces = letter.userData.pieces;
    const halfDepth = letter.userData.halfDepth;
    if (!pieces) return;

    const q = this.quaternion.copy(letter.quaternion);
    const o = letter.position;
    const v = this.point;

    const place = (x, y, z, out) => {
      v.set(x, y, z).applyQuaternion(q);
      out[0] = v.x + o.x;
      out[1] = v.y + o.y;
      out[2] = v.z + o.z;
    };

    const a = [0, 0, 0];
    const b = [0, 0, 0];

    for (const piece of pieces) {
      for (let i = 0; i < piece.length; i++) {
        const j = (i + 1) % piece.length;
        for (const z of [-halfDepth, halfDepth]) {
          place(piece[i].x, piece[i].y, z, a);
          place(piece[j].x, piece[j].y, z, b);
          this.segment(a[0], a[1], a[2], b[0], b[1], b[2], COLLIDER);
        }
        place(piece[i].x, piece[i].y, -halfDepth, a);
        place(piece[i].x, piece[i].y, halfDepth, b);
        this.segment(a[0], a[1], a[2], b[0], b[1], b[2], COLLIDER);
      }
    }
  }

  update(letters, physics, states, group, show, scale) {
    this.count = 0;

    if (show.colliders) {
      for (const letter of letters) this.collider(letter);
    }

    for (let i = 0; i < physics.bodies.length; i++) {
      const entry = physics.bodies[i];
      const p = entry.object.position;
      const s = states[i];

      if (show.velocity && s) {
        this.arrow(p.x, p.y, p.z, s.vx * scale, s.vy * scale, s.vz * scale, VELOCITY);
      }

      if (show.spin && s) {
        const w = entry.body.getAngularVelocity();
        const k = scale * 0.15;
        this.arrow(p.x, p.y, p.z, w.x() * k, w.y() * k, w.z() * k, SPIN);
      }

      if (show.forces && physics.homeStrength > 0) {
        const kp = physics.homeStrength;
        const kd = 2 * Math.sqrt(kp);
        const v = entry.body.getLinearVelocity();
        const k = scale * 0.12;
        this.arrow(
          p.x,
          p.y,
          p.z,
          ((entry.home.x - p.x) * kp - v.x() * kd) * k,
          ((entry.home.y - p.y) * kp - v.y() * kd) * k,
          ((entry.home.z - p.z) * kp - v.z() * kd) * k,
          FORCE,
        );
      }

      if (show.home) {
        this.cross(entry.home.x, entry.home.y, entry.home.z, 0.03, HOME);
        this.segment(
          p.x,
          p.y,
          p.z,
          entry.home.x,
          entry.home.y,
          entry.home.z,
          HOME,
        );
      }
    }

    if (show.contacts) {
      for (const c of physics.contacts) {
        this.cross(c.x, c.y, c.z, 0.02 + Math.min(c.impulse, 1) * 0.05, CONTACT);
      }
    }

    this.lines.matrix.copy(group.matrixWorld);
    this.geometry.setDrawRange(0, this.count);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    return this.count;
  }

  render(renderer, camera) {
    if (this.count === 0) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, camera);
    renderer.autoClear = autoClear;
  }
}

export { PhysicsDebug };
