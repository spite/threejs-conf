const FORCE_CUTOFF = 0.01;

class Physics {
  constructor(ammo) {
    this.ammo = ammo;
    this.bodies = [];

    const config = new ammo.btDefaultCollisionConfiguration();
    this.dispatcher = new ammo.btCollisionDispatcher(config);
    this.broadphase = new ammo.btDbvtBroadphase();
    this.solver = new ammo.btSequentialImpulseConstraintSolver();
    this.world = new ammo.btDiscreteDynamicsWorld(
      this.dispatcher,
      this.broadphase,
      this.solver,
      config,
    );
    this.world.setGravity(new ammo.btVector3(0, 0, 0));

    this.transform = new ammo.btTransform();
    this.vec = new ammo.btVector3(0, 0, 0);
    this.vec2 = new ammo.btVector3(0, 0, 0);

    this.clusterStrength = 0;
    this.clusterRadius = 0.35;
    this.clusterSettle = 0.5;
    this.contacts = [];
    this.cooldown = new Map();
    this.minImpulse = 0.02;
    this.contactCooldown = 0.08;
    this.clock = 0;
    this.idleStrength = 0;
    this.homeStrength = 2.5;
    this.homeTorque = 1.5;
    this.damping = 0.05;
    this.bounce = 0.35;
    this.gravity = { x: 0, y: 0, z: 0 };
  }

  static async create(factory) {
    const ammo = await factory();
    return new Physics(ammo);
  }

  makeShape(pieces, halfDepth, scale) {
    const ammo = this.ammo;
    const compound = new ammo.btCompoundShape();
    const identity = new ammo.btTransform();
    identity.setIdentity();

    for (const piece of pieces) {
      const hull = new ammo.btConvexHullShape();
      for (const p of piece) {
        for (const z of [-halfDepth, halfDepth]) {
          this.vec.setValue(p.x * scale, p.y * scale, z * scale);
          hull.addPoint(this.vec, true);
        }
      }
      hull.setMargin(0.002);
      compound.addChildShape(identity, hull);
    }

    ammo.destroy(identity);
    return compound;
  }

  makeSphere(radius) {
    return new this.ammo.btSphereShape(radius);
  }

  drive(entry, target, strength) {
    const kp = strength;
    const kd = 2 * Math.sqrt(kp);

    entry.body.getMotionState().getWorldTransform(this.transform);
    const o = this.transform.getOrigin();
    const v = entry.body.getLinearVelocity();

    entry.body.activate();
    this.vec.setValue(
      entry.mass * ((target.x - o.x()) * kp - v.x() * kd),
      entry.mass * ((target.y - o.y()) * kp - v.y() * kd),
      entry.mass * ((target.z - o.z()) * kp - v.z() * kd),
    );
    entry.body.applyCentralForce(this.vec);
  }

  remove(entry) {
    const at = this.bodies.indexOf(entry);
    if (at < 0) return;
    this.world.removeRigidBody(entry.body);
    this.bodies.splice(at, 1);
  }

  addBody(object, shape, mass, driven = false) {
    const ammo = this.ammo;
    const inertia = new ammo.btVector3(0, 0, 0);
    if (mass > 0) shape.calculateLocalInertia(mass, inertia);
    const inertiaScalar =
      mass > 0 ? (inertia.x() + inertia.y() + inertia.z()) / 3 : 1;

    const transform = new ammo.btTransform();
    transform.setIdentity();
    transform.setOrigin(
      new ammo.btVector3(
        object.position.x,
        object.position.y,
        object.position.z,
      ),
    );

    const motionState = new ammo.btDefaultMotionState(transform);
    const info = new ammo.btRigidBodyConstructionInfo(
      mass,
      motionState,
      shape,
      inertia,
    );
    const body = new ammo.btRigidBody(info);
    body.setUserIndex(this.bodies.length + 1);

    body.setDamping(this.damping, this.damping);
    body.setRestitution(this.bounce);
    body.setFriction(0.5);
    body.setActivationState(4);

    this.world.addRigidBody(body);
    const entry = {
      body,
      object,
      motionState,
      mass,
      shape,
      inertia: inertiaScalar,
      radius: object.userData?.bodyRadius ?? 0.1,
      phase: [
        Math.random() * 6.2831853,
        Math.random() * 6.2831853,
        Math.random() * 6.2831853,
      ],
      home: {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
      },
      driven,
    };
    this.bodies.push(entry);

    ammo.destroy(info);
    return entry;
  }

  applyForces() {
    let clusterGate = 1;
    if (this.clusterStrength > 0 && this.clusterSettle > 0) {
      let speed = 0;
      for (const entry of this.bodies) {
        const v = entry.body.getLinearVelocity();
        speed += Math.sqrt(
          v.x() * v.x() + v.y() * v.y() + v.z() * v.z(),
        );
      }
      speed /= Math.max(this.bodies.length, 1);
      clusterGate = Math.min(speed / this.clusterSettle, 1);
      clusterGate *= clusterGate;
    }

    for (const entry of this.bodies) {
      if (entry.driven) continue;

      entry.body.getMotionState().getWorldTransform(this.transform);
      const o = this.transform.getOrigin();
      const x = o.x();
      const y = o.y();
      const z = o.z();

      let fx = 0;
      let fy = 0;
      let fz = 0;

      if (this.homeStrength > 0) {
        const kp = this.homeStrength;
        const kd = 2 * Math.sqrt(kp);
        const v = entry.body.getLinearVelocity();
        fx += entry.mass * ((entry.home.x - x) * kp - v.x() * kd);
        fy += entry.mass * ((entry.home.y - y) * kp - v.y() * kd);
        fz += entry.mass * ((entry.home.z - z) * kp - v.z() * kd);
      }

      if (this.clusterStrength > 0) {
        const d = Math.sqrt(x * x + y * y + z * z);
        if (d > 1e-5) {
          const pull =
            -this.clusterStrength *
            clusterGate *
            Math.max(d - this.clusterRadius, 0);
          fx += (x / d) * pull;
          fy += (y / d) * pull;
          fz += (z / d) * pull;
        }
      }

      if (this.idleStrength > 0) {
        const t = this.clock;
        const p = entry.phase;
        const a = this.idleStrength * entry.mass;
        fx += a * Math.sin(t * 0.83 + p[0]) * Math.sin(t * 0.29 + p[1]);
        fy += a * Math.sin(t * 0.97 + p[1]) * Math.sin(t * 0.37 + p[2]);
        fz += a * Math.sin(t * 0.71 + p[2]) * Math.sin(t * 0.23 + p[0]);
      }

      if (fx !== 0 || fy !== 0 || fz !== 0) {
        entry.body.activate();
        this.vec.setValue(fx, fy, fz);
        entry.body.applyCentralForce(this.vec);
      }

      if (this.homeTorque > 0) {
        const q = this.transform.getRotation();
        let qx = -q.x();
        let qy = -q.y();
        let qz = -q.z();
        let qw = q.w();
        if (qw < 0) {
          qx = -qx;
          qy = -qy;
          qz = -qz;
          qw = -qw;
        }
        const s = Math.sqrt(qx * qx + qy * qy + qz * qz);
        const kp = this.homeTorque;
        const kd = 2 * Math.sqrt(kp);
        const w = entry.body.getAngularVelocity();
        let ax = 0;
        let ay = 0;
        let az = 0;
        if (s > 1e-6) {
          const angle = 2 * Math.atan2(s, qw);
          ax = (qx / s) * angle;
          ay = (qy / s) * angle;
          az = (qz / s) * angle;
        }
        entry.body.activate();
        this.vec2.setValue(
          entry.inertia * (ax * kp - w.x() * kd),
          entry.inertia * (ay * kp - w.y() * kd),
          entry.inertia * (az * kp - w.z() * kd),
        );
        entry.body.applyTorque(this.vec2);
      }

      if (this.idleStrength > 0) {
        const t = this.clock;
        const p = entry.phase;
        const a = this.idleStrength * entry.inertia * 1.5;
        entry.body.activate();
        this.vec2.setValue(
          a * Math.sin(t * 0.61 + p[2]),
          a * Math.sin(t * 0.79 + p[0]),
          a * Math.sin(t * 0.53 + p[1]),
        );
        entry.body.applyTorque(this.vec2);
      }
    }
  }

  eachInRange(origin, radius, mode, visit) {
    for (const entry of this.bodies) {
      entry.body.getMotionState().getWorldTransform(this.transform);
      const o = this.transform.getOrigin();
      const dx = o.x() - origin.x;
      const dy = o.y() - origin.y;
      const dz = o.z() - origin.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const falloff = this.falloff(dist, radius, mode);
      if (falloff < FORCE_CUTOFF) continue;

      entry.body.activate();
      visit(entry, dx, dy, dz, dist, falloff);
    }
  }

  push(origin, direction, strength, radius, mode = "soft") {
    this.eachInRange(origin, radius, mode, (entry, dx, dy, dz, dist, falloff) => {
      const k = strength * falloff;
      this.vec.setValue(
        (dx * 0.5 + direction.x) * k,
        (dy * 0.5 + direction.y) * k,
        (dz * 0.5 + direction.z) * k,
      );
      entry.body.applyCentralImpulse(this.vec);
    });
  }

  setMass(entry, value) {
    const mass = Math.max(value, 1e-3);
    if (Math.abs(mass - entry.mass) < 1e-6) return;

    const inertia = new this.ammo.btVector3(0, 0, 0);
    entry.shape.calculateLocalInertia(mass, inertia);
    entry.body.setMassProps(mass, inertia);
    entry.body.updateInertiaTensor();
    entry.body.activate();

    entry.mass = mass;
    entry.inertia = (inertia.x() + inertia.y() + inertia.z()) / 3;
    this.ammo.destroy(inertia);
  }

  setMasses(masses) {
    for (let i = 0; i < masses.length && i < this.bodies.length; i++) {
      this.setMass(this.bodies[i], masses[i]);
    }
  }

  pull(origin, strength, radius) {
    if (strength <= 0) return;

    const kp = strength;
    const kd = 2 * Math.sqrt(kp);

    for (const entry of this.bodies) {
      entry.body.getMotionState().getWorldTransform(this.transform);
      const o = this.transform.getOrigin();
      const v = entry.body.getLinearVelocity();

      let dx = origin.x - o.x();
      let dy = origin.y - o.y();
      let dz = origin.z - o.z();

      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 1e-5) {
        const reach = Math.max(dist - radius, 0) / dist;
        dx *= reach;
        dy *= reach;
        dz *= reach;
      }

      entry.body.activate();
      this.vec.setValue(
        entry.mass * (dx * kp - v.x() * kd),
        entry.mass * (dy * kp - v.y() * kd),
        entry.mass * (dz * kp - v.z() * kd),
      );
      entry.body.applyCentralForce(this.vec);
    }
  }

  falloff(dist, radius, mode) {
    const t = dist / Math.max(radius, 1e-5);

    if (mode === "sharp") {
      return Math.exp(-2 * t * t);
    }

    if (mode === "point") {
      const k = Math.max(0, 1 - t);
      return k * k * 3;
    }

    return 1 / (1 + t * t);
  }

  burst(origin, direction, strength, radius, mode = "soft", spin = 1) {
    this.eachInRange(origin, radius, mode, (entry, dx, dy, dz, dist, falloff) => {
      const d = Math.max(dist, 1e-5);
      const nx = -dx / d;
      const ny = -dy / d;
      const nz = -dz / d;
      const mag = strength * falloff;
      const arm = Math.min(d, entry.radius) * spin;

      this.vec.setValue(
        (direction.x * 0.75 - nx * 0.25) * mag,
        (direction.y * 0.75 - ny * 0.25) * mag,
        (direction.z * 0.75 - nz * 0.25) * mag,
      );
      this.vec2.setValue(nx * arm, ny * arm, nz * arm);
      entry.body.applyImpulse(this.vec, this.vec2);
    });
  }

  setGravity(x, y, z) {
    const g = this.gravity;
    if (x === g.x && y === g.y && z === g.z) return;
    g.x = x;
    g.y = y;
    g.z = z;
    this.vec.setValue(x, y, z);
    this.world.setGravity(this.vec);
  }

  configure(settings) {
    this.homeStrength = settings.homeStrength;
    this.homeTorque = settings.homeTorque;
    this.idleStrength = settings.idleStrength;
    this.clusterStrength = settings.clusterStrength;
    this.clusterRadius = settings.clusterRadius;
    this.clusterSettle = settings.clusterSettle;

    if (settings.damping !== this.damping) {
      this.damping = settings.damping;
      for (const entry of this.bodies) {
        entry.body.setDamping(this.damping, this.damping);
      }
    }
    if (settings.bounce !== this.bounce) {
      this.bounce = settings.bounce;
      for (const entry of this.bodies) entry.body.setRestitution(this.bounce);
    }
  }

  collectContacts() {
    this.contacts.length = 0;
    const count = this.dispatcher.getNumManifolds();

    for (let i = 0; i < count; i++) {
      const manifold = this.dispatcher.getManifoldByIndexInternal(i);
      const points = manifold.getNumContacts();
      if (points === 0) continue;

      let impulse = 0;
      let px = 0;
      let py = 0;
      let pz = 0;
      for (let j = 0; j < points; j++) {
        const p = manifold.getContactPoint(j);
        const value = p.getAppliedImpulse();
        if (value > impulse) {
          impulse = value;
          const w = p.get_m_positionWorldOnB();
          px = w.x();
          py = w.y();
          pz = w.z();
        }
      }
      if (impulse < this.minImpulse) continue;

      const a = manifold.getBody0().getUserIndex();
      const b = manifold.getBody1().getUserIndex();
      const key = a < b ? a * 4096 + b : b * 4096 + a;

      const last = this.cooldown.get(key) ?? -1e9;
      if (this.clock - last < this.contactCooldown) continue;
      this.cooldown.set(key, this.clock);

      this.contacts.push({ impulse, a, b, x: px, y: py, z: pz });
    }

    return this.contacts;
  }

  stats(out) {
    let speed = 0;
    let spin = 0;
    let energy = 0;
    let maxSpeed = 0;
    let maxDrift = 0;
    let awake = 0;

    for (const entry of this.bodies) {
      const v = entry.body.getLinearVelocity();
      const w = entry.body.getAngularVelocity();
      const vx = v.x();
      const vy = v.y();
      const vz = v.z();
      const wx = w.x();
      const wy = w.y();
      const wz = w.z();

      const v2 = vx * vx + vy * vy + vz * vz;
      const w2 = wx * wx + wy * wy + wz * wz;
      const s = Math.sqrt(v2);

      speed += s;
      spin += Math.sqrt(w2);
      energy += 0.5 * (entry.mass * v2 + entry.inertia * w2);
      if (s > maxSpeed) maxSpeed = s;
      if (entry.body.isActive()) awake++;

      const p = entry.object.position;
      const dx = p.x - entry.home.x;
      const dy = p.y - entry.home.y;
      const dz = p.z - entry.home.z;
      const drift = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (drift > maxDrift) maxDrift = drift;
    }

    const n = Math.max(this.bodies.length, 1);
    out.bodies = this.bodies.length;
    out.awake = awake;
    out.speed = speed / n;
    out.spin = spin / n;
    out.maxSpeed = maxSpeed;
    out.maxDrift = maxDrift;
    out.energy = energy;
    out.contacts = this.contacts.length;
    out.manifolds = this.dispatcher.getNumManifolds();

    let impulse = 0;
    for (const c of this.contacts) if (c.impulse > impulse) impulse = c.impulse;
    out.impulse = impulse;

    return out;
  }

  velocities(out) {
    for (let i = 0; i < this.bodies.length; i++) {
      const entry = this.bodies[i];
      const v = entry.body.getLinearVelocity();
      const w = entry.body.getAngularVelocity();
      const p = entry.object.position;

      const vx = v.x();
      const vy = v.y();
      const vz = v.z();
      const wx = w.x();
      const wy = w.y();
      const wz = w.z();

      let s = out[i];
      if (!s) {
        s = { speed: 0, spin: 0, pitch: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
        out[i] = s;
      }

      s.speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      s.spin = Math.sqrt(wx * wx + wy * wy + wz * wz);
      s.x = p.x;
      s.y = p.y;
      s.z = p.z;
      s.vx = vx;
      s.vy = vy;
      s.vz = vz;
    }
    out.length = this.bodies.length;
    return out;
  }

  step(dt) {
    this.clock += dt;
    this.applyForces();
    this.world.stepSimulation(Math.min(dt, 1 / 30), 4, 1 / 120);
    this.collectContacts();

    for (const entry of this.bodies) {
      entry.body.getMotionState().getWorldTransform(this.transform);
      const o = this.transform.getOrigin();
      const q = this.transform.getRotation();
      entry.object.position.set(o.x(), o.y(), o.z());
      entry.object.quaternion.set(q.x(), q.y(), q.z(), q.w());
    }
  }

  dispose() {
    for (const entry of this.bodies) this.world.removeRigidBody(entry.body);
    this.bodies.length = 0;
  }
}

export { Physics };
