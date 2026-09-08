import {
  isEditing,
  setMaxPixelRatio,
  renderer,
  camera,
  controls,
  render,
  onResize,
  running,
  clock,
} from "common";
import GUI from "gui";
import { buildPanel } from "modules/guiPanel.js";
import { debugViewIndex } from "modules/debugViews.js";
import { createParams } from "params";
import { createStats } from "stats";
import { readUrlOverrides, syncHash } from "modules/urlState.js";
import Maf from "maf";
import {
  Scene,
  Mesh,
  Color,
  Vector2,
  Vector3,
  Quaternion,
  Plane,
  Raycaster,
  Group,
  HemisphereLight,
  SphereGeometry,
  DirectionalLight,
  PointLight,
} from "three";
import { collectLights, loadEnvMap } from "modules/material.js";
import { signal, tweened, batch, effectRAF } from "reactive";
import { Easings } from "easings";
import { loadFont } from "modules/GlyphSDF.js";
import { SSAO } from "modules/SSAO.js";
import { Physics } from "modules/Physics.js";
import { createSound } from "modules/sound.js";
import { createTilt } from "modules/tilt.js";
import { createLetters } from "modules/letters.js";
import { makeGlowMaterial } from "modules/letterMaterial.js";
import { PhysicsDebug } from "modules/PhysicsDebug.js";
import { defaults, QUALITY, LOOKS, FEELS } from "modules/defaults.js";

const blendFactor = tweened(0, 1000);

const background = new Color();
const bgLight = new Color();
const skyColor = new Color();
const groundColor = new Color();

const params = createParams(defaults, {
  storageKey: "threejs-conf:params",
  migrate: (stored) => ({ ...stored, ...readUrlOverrides(defaults) }),
});

const urlState = syncHash(params, defaults, regenerate);

function applyQuality(name) {
  const preset = QUALITY[name];
  if (!preset) return;
  batch(() => {
    for (const [key, value] of Object.entries(preset)) params[key].set(value);
  });
  regenerate();
}

function regenerate() {
  rebuild.set(rebuild.peek() + 1);
}

function resetParams() {
  params.$reset();
  params.$clear();
  urlState.write();
  regenerate();
}


async function copyStateLink() {
  const url = `${location.origin}${location.pathname}${urlState.stateHash()}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch (e) {
    console.warn("could not copy link", e);
  }
}

const tint = { hue: NaN, spread: NaN, sat: NaN, light: NaN, count: 0 };

const stats = createStats();
const monitors = {};

const track = (name, monitor) => (monitors[name] = monitor);
const timer = (name) => track(name, stats.timer(name, { average: 250 }));
const counter = (name, average) =>
  track(name, stats.counter(name, average ? { average } : undefined));

const statFps = track("fps", stats.fps());
const statFrame = timer("frame");
const statPhysics = timer("physics");
const statRender = timer("render");
const statAudio = timer("audio");
const statTriangles = counter("triangles");
const statCalls = counter("calls");
const statGeometries = counter("geometries");
const statTextures = counter("textures");
const statPrograms = counter("programs");
const statBuild = counter("build");
const statAttract = counter("attract");

const statBodies = counter("bodies");
const statAwake = counter("awake");
const statContacts = counter("contacts", 500);
const statManifolds = counter("manifolds");
const statImpulse = counter("impulse", 500);
const statSpeed = counter("speed", 250);
const statSpin = counter("spin", 250);
const statEnergy = counter("energy", 250);
const statDrift = counter("drift", 250);

const statVoices = counter("voices");
const statLimiter = counter("limiter", 250);
const statImpactComp = counter("impactComp", 250);
const statSwish = counter("swish", 250);
const statLatency = counter("latency");
const audioInfo = signal("off");

const physicsStats = {};
const audioStats = {};

const gui = new GUI("threejs-conf", document.querySelector("#gui-container"), {
  storageKey: "threejs-conf",
});

buildPanel(
  gui,
  params,
  {
    randomize,
    resetParams,
    copyStateLink,
    regenerate,
    applyQuality,
    applyLook,
    applyFeel,
  },
  { ...monitors, info: audioInfo },
);
gui.show();

const scene = new Scene();
const group = new Group();
scene.add(group);

const light = new DirectionalLight(0xffffff, 3);
light.position.set(3, 6, 3);
scene.add(light);

const KEY_HOME = new Vector3(3, 6, 3).normalize();
const keyDir = new Vector3();
const backDir = new Vector3();
const cameraRight = new Vector3();
const worldUp = new Vector3(0, 1, 0);

const cursorLight = new PointLight(0xffffff, 0, 4, 2);
cursorLight.position.set(0, 0, 1);
scene.add(cursorLight);

const NO_SHADOW_LAYER = 1;

const cursorBall = new Mesh(
  new SphereGeometry(1, 32, 24),
  makeGlowMaterial(camera, new Color().setScalar(6)),
);
cursorBall.frustumCulled = false;
cursorBall.layers.set(NO_SHADOW_LAYER);
camera.layers.enable(NO_SHADOW_LAYER);
scene.add(cursorBall);

const BALL_SIZE = 0.06;
const lightProxy = { position: new Vector3(), quaternion: new Quaternion() };
const lightTarget = new Vector3();
let lightEntry = null;
const PULSE_STIFFNESS = 180;
const PULSE_DAMPING = 14;
const PULSE_STEP = 1 / 240;
const MAX_DT = 1 / 30;
const BALL_SMOOTH = 0.35;
let pulse = 0;
let pulseVelocity = 0;
const ballUp = new Vector3(0, 1, 0);
const ballDir = new Vector3(0, 1, 0);
const ballDelta = new Vector3();
const ballPrevious = new Vector3();
const ballVelocity = new Vector3();

const hemiLight = new HemisphereLight(0xffffff, 0xffffff, 2);
hemiLight.position.set(0, 1, 0);
scene.add(hemiLight);

const font = await loadFont("./assets/GoogleSansFlex-Black.ttf");
const physics = await Physics.create(window.Ammo);

const revision = signal(0);
const rebuild = signal(0);

group.scale.setScalar(1.4);

const text = createLetters({
  renderer,
  camera,
  scene,
  group,
  physics,
  font,
  params,
  revision,
  rebuild,
  statBuild,
  tint,
  bgLight,
});
const letters = text.letters;

effectRAF(() => {
  revision();
  light.color.set(params.keyColor());
  light.intensity = params.keyIntensity();
  hemiLight.color.set(params.skyColor());
  hemiLight.groundColor.set(params.groundColor());
  hemiLight.intensity = params.skyIntensity();

  const lights = collectLights(scene);
  for (const letter of letters) letter.material.syncLights(lights);
});

const sound = createSound({ camera, group, letters, physics, params });
const audio = sound.audio;

const physicsDebug = new PhysicsDebug();
const debugStates = [];
const debugShow = {};

const ssao = new SSAO();
const ao = ssao.shader.uniforms;
const mb = ssao.blurShader.uniforms;
ssao.setLight(light.position.x, light.position.y, light.position.z);

const shadowCenter = new Vector3();
const pointerScenePoint = new Vector3();
const pullPoint = new Vector3();

const TILT_GRAVITY = 4;
const tilt = createTilt();
const tiltVec = { x: 0, y: 0 };
const tiltGravity = new Vector3();
const cameraUp = new Vector3();
const MAX_CLICK_CHARGE = 4;
let clickCharge = 0;

function fitShadow() {
  const s = group.scale.x || 1;
  if (!letters.length) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const letter of letters) {
    const r = letter.userData.bodyRadius * s;
    const x = letter.position.x * s + group.position.x;
    const y = letter.position.y * s + group.position.y;
    const z = letter.position.z * s + group.position.z;
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
    minZ = Math.min(minZ, z - r);
    maxZ = Math.max(maxZ, z + r);
  }

  shadowCenter.set(
    0.5 * (minX + maxX),
    0.5 * (minY + maxY),
    0.5 * (minZ + maxZ),
  );
  const radius =
    0.5 *
    Math.sqrt(
      (maxX - minX) * (maxX - minX) +
        (maxY - minY) * (maxY - minY) +
        (maxZ - minZ) * (maxZ - minZ),
    );
  ssao.fitShadow(shadowCenter, radius * 1.05);

  const dist = camera.position.distanceTo(shadowCenter);
  ssao.shader.uniforms.depthRange.value.set(
    Math.max(camera.near, dist - radius),
    dist + radius,
  );
}
onResize((w, h) => ssao.setSize(w, h, renderer.getPixelRatio()));

camera.position.set(-1.735, -0.372, 4.237);
camera.lookAt(0, 0, 0);
controls.target.set(0, 0, 0);
controls.update();

let assetsReady = false;
const audioHint = document.querySelector("#audio-hint");
let audioHintShown = null;

function updateAudioHint() {
  if (!audioHint) return;
  const blocked = params.sound() && sound.blocked();
  if (blocked === audioHintShown) return;
  audioHintShown = blocked;
  audioHint.classList.toggle("visible", blocked);
}

function hideLoading() {
  const el = document.querySelector("#loading");
  if (!el) return;
  el.classList.add("done");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
}

async function init() {
  try {
    const envMap = await loadEnvMap(
      `./assets/spruit_sunrise_2k.hdr.jpg`,
      renderer,
    );
    text.setEnvMap(envMap);
  } catch (e) {
    console.warn("could not load the environment map", e);
  }
  assetsReady = true;
}

init();

let hueFrom = params.hue.peek();
let hueTo = hueFrom;

function setHue(value) {
  hueFrom = hueTo;
  hueTo = value;
  params.hue.set(value);
  blendFactor.reset(0);
  blendFactor.set(1);
}

function applyLook(name) {
  const preset = LOOKS[name];
  if (!preset) return;
  batch(() => {
    for (const [key, value] of Object.entries(preset)) params[key].set(value);
  });
  setHue(preset.hue);
}

function applyFeel(name) {
  const preset = FEELS[name];
  if (!preset) return;
  batch(() => {
    for (const [key, value] of Object.entries(preset)) params[key].set(value);
  });
}

function randomize() {
  setHue(Math.random());
  params.seed.set(Maf.intRandomInRange(0, 1e6));
  params.stampDensity.set(Maf.randomInRange(0.3, 1.6));
  const low = Maf.randomInRange(0.15, 0.6);
  params.stampSize.set([low, low + Maf.randomInRange(0.2, 0.9)]);
}

const pointer = new Vector2();
const raycaster = new Raycaster();
const pushPlane = new Plane();
const pushPoint = new Vector3();
const pushDir = new Vector3();
const cameraDir = new Vector3();
let pointerDown = false;
let idleTime = 0;
let attracting = false;
let burstTimer = 0;
const burstPoint = new Vector3();
const burstDir = new Vector3();

function wake() {
  idleTime = 0;
  attracting = false;
}

function throwLetters(origin, direction, strength, pulse) {
  physics.burst(
    origin,
    direction,
    strength,
    params.clickRadius(),
    params.falloff(),
    params.clickSpin(),
  );
  pulseVelocity += pulse;
}

function randomBurstDir() {
  return burstDir
    .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
    .normalize();
}

function attractBurst() {
  if (!letters.length) return;
  const letter = letters[Math.floor(Math.random() * letters.length)];
  burstPoint.copy(letter.position);
  throwLetters(burstPoint, randomBurstDir(), params.clickStrength() * 0.6, 10);
}

function stepAttract(dt) {
  const after = params.attract();
  if (after <= 0 || !running) {
    if (attracting) attracting = false;
    controls.autoRotate = false;
    statAttract.sample(running ? -1 : -2);
    return;
  }

  idleTime += dt;
  if (!attracting && idleTime > after) {
    attracting = true;
    burstTimer = 0;
  }

  statAttract.sample(attracting ? 0 : Math.max(after - idleTime, 0));

  controls.autoRotate = attracting;
  controls.autoRotateSpeed = params.attractSpin();

  if (!attracting) return;

  const every = params.attractBurst();
  if (every <= 0 || !params.physics()) return;

  burstTimer -= dt;
  if (burstTimer <= 0) {
    burstTimer = every * (0.7 + Math.random() * 0.6);
    attractBurst();
  }
}
let pointerOver = false;
let pointerOnUI = false;
let shiftDown = false;
let altDown = false;
const canvas = renderer.domElement;

function fromScene(e) {
  return e.target === canvas;
}

function updatePointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function pointerWorld() {
  camera.getWorldDirection(cameraDir);
  pushPlane.setFromNormalAndCoplanarPoint(cameraDir, group.position);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(pushPlane, pushPoint)) return false;
  pointerScenePoint.copy(pushPoint);
  pushPoint.sub(group.position).multiplyScalar(1 / (group.scale.x || 1));
  return true;
}

window.addEventListener("pointermove", (e) => {
  wake();
  updatePointer(e);
  pointerOver = fromScene(e);
});

window.addEventListener("pointerdown", (e) => {
  wake();
  sound.start();
  if (params.tilt() > 0) tilt.request();

  pointerOnUI = !fromScene(e);
  if (pointerOnUI) {
    pointerDown = false;
    pointerOver = false;
    return;
  }

  updatePointer(e);
  pointerDown = true;
});

window.addEventListener("pointerup", () => {
  if (pointerOnUI) {
    pointerOnUI = false;
    pointerDown = false;
    return;
  }

  if (pointerDown && running && !altDown && params.physics() && pointerWorld()) {
    pushDir.copy(raycaster.ray.direction);
    clickCharge = Math.min(clickCharge + 1, MAX_CLICK_CHARGE);
    throwLetters(
      pushPoint,
      pushDir,
      params.clickStrength() * (1 + (clickCharge - 1) * params.clickBuildup()),
      14,
    );
  }
  pointerDown = false;
});

window.addEventListener("pointerleave", () => {
  pointerOver = false;
});

window.addEventListener("keydown", (e) => {
  if (isEditing(e.target)) return;
  wake();
  if (e.key === "Shift") shiftDown = true;
  if (e.key === "Alt") altDown = true;
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") shiftDown = false;
  if (e.key === "Alt") altDown = false;
});

window.addEventListener("blur", () => {
  shiftDown = false;
  altDown = false;
});

document.addEventListener("visibilitychange", () => {
  audio.setActive(!document.hidden);
  shiftDown = false;
  altDown = false;
});

window.addEventListener("pointercancel", () => {
  pointerOnUI = false;
  pointerDown = false;
});

function applyTilt(dt) {
  const strength = params.tilt();
  if (strength <= 0 || !tilt.active) {
    physics.setGravity(0, 0, 0);
    return;
  }

  tilt.update(dt);

  const shake = tilt.takeShake();
  if (shake > 0) {
    wake();
    if (running && params.physics() && params.tiltShake() > 0) {
      burstPoint.set(0, 0, 0);
      throwLetters(
        burstPoint,
        randomBurstDir(),
        params.clickStrength() * params.tiltShake() * Math.min(shake, 3),
        12,
      );
    }
  }

  if (!tilt.read(tiltVec)) {
    physics.setGravity(0, 0, 0);
    return;
  }

  if (tiltVec.x !== 0 || tiltVec.y !== 0) wake();

  cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
  cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
  tiltGravity
    .copy(cameraRight)
    .multiplyScalar(tiltVec.x)
    .addScaledVector(cameraUp, tiltVec.y)
    .multiplyScalar(strength * TILT_GRAVITY);

  physics.setGravity(tiltGravity.x, tiltGravity.y, tiltGravity.z);
}

function applyHover(dt) {
  if (!pointerWorld()) return;
  pushDir.copy(raycaster.ray.direction).multiplyScalar(0.25);
  physics.push(
    pushPoint,
    pushDir,
    params.hoverStrength() * dt * 60,
    params.hoverRadius(),
    params.falloff(),
  );
}

renderer.info.autoReset = false;

function syncLightBody() {
  const wanted =
    params.lightPhysics() &&
    params.cursorLight() &&
    params.physics() &&
    running;

  if (!wanted) {
    if (lightEntry) {
      physics.remove(lightEntry);
      lightEntry = null;
    }
    return;
  }

  if (lightEntry && physics.bodies.includes(lightEntry)) return;

  lightProxy.position
    .copy(cursorLight.position)
    .sub(group.position)
    .multiplyScalar(1 / (group.scale.x || 1));
  const shape = physics.makeSphere(BALL_SIZE / (group.scale.x || 1));
  lightEntry = physics.addBody(lightProxy, shape, params.lightMass(), true);
}

function stepPhysics(dt) {
  syncLightBody();

  if (params.physics() && running) {
    text.syncMasses(params.massVariation());

    const gathering = shiftDown && pointerOver && !altDown;
    const holding = ((pointerDown && !pointerOnUI) || gathering) && !altDown;
    physics.configure({
      homeStrength: holding ? 0 : params.returnHome(),
      homeTorque: params.returnSpin(),
      idleStrength: params.idle(),
      clusterStrength: params.cluster(),
      clusterRadius: params.clusterRadius(),
      clusterSettle: params.clusterSettle(),
      damping: params.damping(),
      bounce: params.bounce(),
    });
    if (holding) {
      pullPoint
        .copy(cursorLight.position)
        .sub(group.position)
        .multiplyScalar(1 / (group.scale.x || 1));
      physics.pull(pullPoint, params.holdPull(), params.holdRadius());
    } else if (pointerOver && !altDown) {
      applyHover(dt);
    }
    if (lightEntry) physics.setMass(lightEntry, params.lightMass());
    if (lightEntry && pointerWorld()) {
      lightTarget
        .copy(pointerScenePoint)
        .addScaledVector(raycaster.ray.direction, -params.cursorLightOffset())
        .sub(group.position)
        .multiplyScalar(1 / (group.scale.x || 1));
      physics.drive(lightEntry, lightTarget, params.lightFollow());
    }

    statPhysics.start();
    physics.step(dt);
    statPhysics.end();
  }
}

function sampleStats() {
  if (params.showStats()) {
    physics.stats(physicsStats);
    statBodies.sample(physicsStats.bodies);
    statAwake.sample(physicsStats.awake);
    statContacts.sample(physicsStats.contacts);
    statManifolds.sample(physicsStats.manifolds);
    statImpulse.sample(physicsStats.impulse);
    statSpeed.sample(physicsStats.speed);
    statSpin.sample(physicsStats.spin);
    statEnergy.sample(physicsStats.energy);
    statDrift.sample(physicsStats.maxDrift);

    audio.stats(audioStats);
    statVoices.sample(audioStats.voices);
    statLimiter.sample(audioStats.limiter);
    statImpactComp.sample(audioStats.impactComp);
    statSwish.sample(audioStats.swish);
    statLatency.sample(audioStats.latency);
    audioInfo.set(
      `${audioStats.state} · ${(audioStats.sampleRate / 1000).toFixed(1)}kHz · ${audioStats.impactPanners} panners · ${audioStats.reverbTail.toFixed(1)}s tail`,
    );
  }
}

function updateCursorBall(lightOn, dt) {
  cursorBall.visible = lightOn;
  if (!lightOn) {
    ballPrevious.copy(cursorLight.position);
    return;
  }

  cursorBall.position.copy(cursorLight.position);
  ballDelta
    .subVectors(cursorBall.position, ballPrevious)
    .divideScalar(Math.max(dt, 1e-4));
  ballVelocity.lerp(ballDelta, 1 - Math.pow(1 - BALL_SMOOTH, dt * 60));
  ballPrevious.copy(cursorBall.position);

  sound.setCursor(cursorBall.position, ballVelocity);

  const speed = ballVelocity.length();
  const stretch = 1 + Math.min(speed / 6, 3);
  const squash = 1 / Math.sqrt(stretch);
  const size = BALL_SIZE * (1 + pulse);

  if (speed > 1e-5) {
    ballDir.copy(ballVelocity).divideScalar(speed);
    cursorBall.quaternion.setFromUnitVectors(ballUp, ballDir);
  }
  cursorBall.scale.set(size * squash, size * stretch, size * squash);
}

function updateKeyLight() {
  const amount = params.backlight();
  keyDir.copy(KEY_HOME);

  if (amount > 0) {
    camera.getWorldDirection(backDir);
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    backDir
      .addScaledVector(worldUp, 0.55)
      .addScaledVector(cameraRight, 0.35)
      .normalize();
    keyDir.lerp(backDir, amount).normalize();
  }

  light.position.copy(keyDir).multiplyScalar(10);
  ssao.setLight(keyDir.x, keyDir.y, keyDir.z);
  for (const letter of letters) letter.material.syncLightValues();
}

function updateSceneAndPost(dt) {
  for (let left = running ? dt : 0; left > 0; left -= PULSE_STEP) {
    const h = Math.min(left, PULSE_STEP);
    pulseVelocity +=
      (-PULSE_STIFFNESS * pulse - PULSE_DAMPING * pulseVelocity) * h;
    pulse += pulseVelocity * h;
  }

  const lightOn = params.cursorLight();
  cursorLight.intensity = lightOn
    ? params.cursorLightIntensity() * (1 + pulse * 2)
    : 0;
  cursorLight.distance = params.cursorLightRange();
  cursorLight.color.set(params.cursorLightColor());
  if (lightEntry) {
    cursorLight.position
      .copy(lightProxy.position)
      .multiplyScalar(group.scale.x || 1)
      .add(group.position);
  } else if (lightOn && pointerWorld()) {
    cursorLight.position
      .copy(pointerScenePoint)
      .addScaledVector(raycaster.ray.direction, -params.cursorLightOffset());
  }
  for (const letter of letters) letter.material.syncPointLights();

  updateCursorBall(lightOn, dt);

  renderer.setClearColor(background);

  camera.updateMatrixWorld();
  updateKeyLight();
  ao.pointLightPosition.value
    .copy(cursorLight.position)
    .applyMatrix4(camera.matrixWorldInverse);
  ao.pointShadowStrength.value = lightOn ? params.cursorShadow() : 0;
  ao.pointShadowSteps.value = Math.round(params.cursorShadowSteps());
  ao.pointShadowThickness.value =
    params.cursorShadowThickness() *
    Math.max(text.depth * (group.scale.x || 1), 0.05);
  ao.pointShadowSoftness.value = params.cursorShadowSoftness();
  ao.pointShadowRays.value = Math.round(params.cursorShadowRays());
  ao.backgroundSky.value.copy(skyColor);
  ao.backgroundGround.value.copy(groundColor);
  setMaxPixelRatio(params.pixelRatio());
  ao.fogDensity.value = params.fogDensity();
  ao.radius.value = params.aoRadius() * renderer.getPixelRatio();
  ao.strength.value = params.aoStrength();
  ao.bias.value = params.aoBias();
  ao.shadowStrength.value = params.shadowStrength();
  ao.shadowRadius.value = params.shadowRadius();
  ao.shadowBias.value = params.shadowBias();

  mb.shutter.value = params.shutter();
  mb.samples.value = Math.round(params.blurSamples());
  mb.maxVelocity.value = params.maxBlur();
  mb.toneMappingExposure.value = params.exposure();
  mb.bloomStrength.value = params.bloom();
  mb.bloomRadius.value = params.bloomRadius();
  ssao.bloom.threshold = params.bloomThreshold();
  ssao.aberrationShader.uniforms.aberration.value = params.chromatic();
  mb.vignette.value = params.vignette();
  mb.dither.value = params.dither();
  ssao.fxaaShader.uniforms.fxaa.value = params.fxaa();

  const view = debugViewIndex.get(params.debugView()) ?? 0;
  ao.debugView.value = view;
  mb.debugView.value = view;
}

render(() => {
  statFrame.tick();
  renderer.info.reset();

  const dt = Math.min(clock.getDelta(), MAX_DT);
  controls.update(dt);
  if (running) {
    clickCharge *= Math.exp(-dt / params.buildupDecay());
  }

  stepAttract(dt);
  applyTilt(dt);
  stepPhysics(dt);

  sampleStats();

  statAudio.start();
  sound.update(dt);
  sound.playContacts();
  statAudio.end();

  const hue = hueFrom + (hueTo - hueFrom) * Easings.OutCubic(blendFactor());
  skyColor.set(params.skyColor());
  groundColor.set(params.groundColor());
  background.copy(groundColor).lerp(skyColor, 0.5);
  bgLight.copy(background);

  text.updateMaterials(hue);

  updateSceneAndPost(dt);

  fitShadow();
  statRender.start();
  ssao.render(renderer, scene, camera);

  debugShow.colliders = params.debugColliders();
  debugShow.velocity = params.debugVelocity();
  debugShow.spin = params.debugSpin();
  debugShow.forces = params.debugForces();
  debugShow.contacts = params.debugContacts();
  debugShow.home = params.debugHome();

  if (Object.values(debugShow).some(Boolean)) {
    physics.velocities(debugStates);
    group.updateMatrixWorld();
    physicsDebug.update(
      letters,
      physics,
      debugStates,
      group,
      debugShow,
      params.debugVectorScale(),
    );
    physicsDebug.render(renderer, camera);
  }
  statRender.end();

  if (assetsReady) {
    assetsReady = false;
    hideLoading();
  }

  updateAudioHint();

  statTriangles.sample(renderer.info.render.triangles);
  statCalls.sample(renderer.info.render.calls);
  statGeometries.sample(renderer.info.memory.geometries);
  statTextures.sample(renderer.info.memory.textures);
  statPrograms.sample(renderer.info.programs.length);
  statFps.tick();
  stats.flush();

  for (const letter of letters) {
    letter.material.uniforms.previousModelViewMatrix.value.multiplyMatrices(
      camera.matrixWorldInverse,
      letter.matrixWorld,
    );
  }

  cursorBall.material.uniforms.previousModelViewMatrix.value.multiplyMatrices(
    camera.matrixWorldInverse,
    cursorBall.matrixWorld,
  );
});
