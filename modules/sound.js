import { Vector3 } from "three";
import { running } from "common";
import { SketchAudio } from "modules/Audio.js";

function createSound({ camera, group, letters, physics, params }) {
  const AUDIO_INTERVAL = 1 / 30;
  let audioClock = AUDIO_INTERVAL;

  const audio = new SketchAudio();
  const velocityStates = [];
  const listenerPosition = [0, 0, 0];
  const listenerForward = [0, 0, -1];
  const listenerUp = [0, 1, 0];
  const listenerVelocity = [0, 0, 0];
  const previousListener = new Vector3();
  let listenerReady = false;
  const contactPoint = [0, 0, 0];
  const contactVelocity = [0, 0, 0];
  const contactOrder = [];

  function toWorld(x, y, z, out) {
    const s = group.scale.x || 1;
    out[0] = x * s + group.position.x;
    out[1] = y * s + group.position.y;
    out[2] = z * s + group.position.z;
    return out;
  }

  function updateListener(dt) {
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;

    listenerPosition[0] = e[12];
    listenerPosition[1] = e[13];
    listenerPosition[2] = e[14];
    listenerForward[0] = -e[8];
    listenerForward[1] = -e[9];
    listenerForward[2] = -e[10];
    listenerUp[0] = e[4];
    listenerUp[1] = e[5];
    listenerUp[2] = e[6];

    if (listenerReady && dt > 1e-5) {
      listenerVelocity[0] = (listenerPosition[0] - previousListener.x) / dt;
      listenerVelocity[1] = (listenerPosition[1] - previousListener.y) / dt;
      listenerVelocity[2] = (listenerPosition[2] - previousListener.z) / dt;
    } else {
      listenerVelocity[0] = 0;
      listenerVelocity[1] = 0;
      listenerVelocity[2] = 0;
    }

    previousListener.set(
      listenerPosition[0],
      listenerPosition[1],
      listenerPosition[2],
    );
    listenerReady = true;

    audio.setListener(
      listenerPosition,
      listenerForward,
      listenerUp,
      listenerVelocity,
    );
  }

  async function startAudio() {
    try {
      await audio.start([
        "./assets/freesound_community-thump1-108128.mp3",
        "./assets/freesound_community-glass-balcony-window-thump-96702.mp3",
      ]);
      audio.setVoiceCount(letters.length);
    } catch (e) {
      console.warn("audio: failed to start", e);
    }
  }

  function updateAudio(dt) {
    if (!audio.ready) return;

    audioClock += dt;
    if (audioClock < AUDIO_INTERVAL) return;

    const audioDt = audioClock;
    audioClock = 0;

    audio.configure({
      volume: params.sound() && running ? params.volume() : 0,
      fade: params.pauseFade(),
      swish: params.swishLevel(),
      spin: params.spinLevel(),
      impact: params.impactLevel(),
      tone: params.soundTone(),
      impactDecay: params.impactDecay(),
      impactPitch: params.impactPitch(),
      spatial: params.spatial(),
      doppler: params.doppler(),
      reverb: params.reverb(),
      reverbSize: params.reverbSize(),
      panningModel: params.hrtf() ? "HRTF" : "equalpower",
    });

    updateListener(audioDt);
    if (audio.voices.length !== letters.length) {
      audio.setVoiceCount(letters.length);
    }

    const pitchBlend = params.pitchBySize();
    const worldScale = group.scale.x || 1;
    physics.velocities(velocityStates);

    for (let i = 0; i < velocityStates.length && i < letters.length; i++) {
      const state = velocityStates[i];
      const ratio = letters[i].userData.volumeRatio;
      const scale = Math.pow(Math.cbrt(1 / ratio), pitchBlend);
      letters[i].userData.pitchScale = scale;
      state.pitch = scale;

      toWorld(state.x, state.y, state.z, contactPoint);
      state.x = contactPoint[0];
      state.y = contactPoint[1];
      state.z = contactPoint[2];
      state.vx *= worldScale;
      state.vy *= worldScale;
      state.vz *= worldScale;
    }

    audio.update(velocityStates);
  }

  function playContacts() {
    if (!audio.ready || !params.sound()) return;

    contactOrder.length = 0;
    for (const contact of physics.contacts) contactOrder.push(contact);
    contactOrder.sort((a, b) => b.impulse - a.impulse);

    for (const contact of contactOrder) {
      const a = letters[contact.a - 1];
      const b = letters[contact.b - 1];
      const pa = a ? a.userData.pitchScale : 1;
      const pb = b ? b.userData.pitchScale : 1;

      toWorld(contact.x, contact.y, contact.z, contactPoint);
      const sa = velocityStates[contact.a - 1];
      const sb = velocityStates[contact.b - 1];
      contactVelocity[0] = ((sa?.vx ?? 0) + (sb?.vx ?? 0)) * 0.5;
      contactVelocity[1] = ((sa?.vy ?? 0) + (sb?.vy ?? 0)) * 0.5;
      contactVelocity[2] = ((sa?.vz ?? 0) + (sb?.vz ?? 0)) * 0.5;

      audio.hit(contact.impulse, Math.min(pa, pb), contactPoint, contactVelocity);
    }
  }

  return { audio, start: startAudio, update: updateAudio, playContacts };
}

export { createSound };
