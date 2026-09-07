const GRAVITY_TAU = 0.15;
const REFERENCE_TAU = 8;
const DEADZONE = 0.05;
const SHAKE_TRIGGER = 12;
const SHAKE_COOLDOWN = 0.35;
const MAX_INTERVAL = 0.1;

function createTilt() {
  const supported =
    typeof window !== "undefined" &&
    typeof window.DeviceMotionEvent !== "undefined";
  const needsPermission =
    supported && typeof DeviceMotionEvent.requestPermission === "function";

  const gravity = { x: 0, y: 0, z: 0 };
  const reference = { x: 0, y: 0, z: 0 };

  let listening = false;
  let denied = false;
  let hasReading = false;
  let shakePeak = 0;
  let cooldown = 0;

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.x === undefined) return;

    if (!hasReading) {
      gravity.x = reference.x = a.x;
      gravity.y = reference.y = a.y;
      gravity.z = reference.z = a.z;
      hasReading = true;
      return;
    }

    const dt = Math.min(Math.max((e.interval || 16) / 1000, 1e-3), MAX_INTERVAL);

    const k = 1 - Math.exp(-dt / GRAVITY_TAU);
    gravity.x += (a.x - gravity.x) * k;
    gravity.y += (a.y - gravity.y) * k;
    gravity.z += (a.z - gravity.z) * k;

    const dx = a.x - gravity.x;
    const dy = a.y - gravity.y;
    const dz = a.z - gravity.z;
    const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (mag > shakePeak) shakePeak = mag;

    const r = 1 - Math.exp(-dt / REFERENCE_TAU);
    reference.x += (gravity.x - reference.x) * r;
    reference.y += (gravity.y - reference.y) * r;
    reference.z += (gravity.z - reference.z) * r;
  }

  function listen() {
    if (listening || !supported) return;
    window.addEventListener("devicemotion", onMotion);
    listening = true;
  }

  async function request() {
    if (listening || denied || !supported) return listening;
    if (!needsPermission) {
      listen();
      return listening;
    }
    try {
      const result = await DeviceMotionEvent.requestPermission();
      if (result === "granted") listen();
      else denied = true;
    } catch (err) {
      denied = true;
      console.warn("motion permission refused", err);
    }
    return listening;
  }

  function recentre() {
    reference.x = gravity.x;
    reference.y = gravity.y;
    reference.z = gravity.z;
  }

  function read(out) {
    if (!hasReading) return false;

    const len =
      Math.sqrt(
        gravity.x * gravity.x + gravity.y * gravity.y + gravity.z * gravity.z,
      ) || 9.81;

    const x = (gravity.x - reference.x) / len;
    const y = (gravity.y - reference.y) / len;

    const angle =
      ((typeof screen !== "undefined" && screen.orientation
        ? screen.orientation.angle
        : 0) *
        Math.PI) /
      180;
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    const rx = x * c - y * s;
    const ry = x * s + y * c;

    const mag = Math.sqrt(rx * rx + ry * ry);
    if (mag <= DEADZONE) {
      out.x = 0;
      out.y = 0;
      return true;
    }

    const scale = (mag - DEADZONE) / mag;
    out.x = rx * scale;
    out.y = ry * scale;
    return true;
  }

  function update(dt) {
    if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
  }

  function takeShake() {
    const peak = shakePeak;
    shakePeak = 0;
    if (cooldown > 0 || peak < SHAKE_TRIGGER) return 0;
    cooldown = SHAKE_COOLDOWN;
    return peak / SHAKE_TRIGGER;
  }

  return {
    supported,
    needsPermission,
    request,
    recentre,
    read,
    update,
    takeShake,
    get active() {
      return listening && hasReading;
    },
    get denied() {
      return denied;
    },
  };
}

export { createTilt };
