const NOISE_BUFFERS = 3;
const NOISE_SECONDS = 2;
const IMPACT_PANNERS = 8;

function makeNoise(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const fade = Math.min(Math.floor(ctx.sampleRate * 0.05), length >> 2);
  const raw = new Float32Array(length + fade);

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.15;
    b6 = w * 0.115926;
  }

  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = raw[i];
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[i] = raw[i] * Math.sqrt(t) + raw[length + i] * Math.sqrt(1 - t);
  }

  return buffer;
}

function ramp3(px, py, pz, x, y, z, now, smooth) {
  px.setTargetAtTime(x, now, smooth);
  py.setTargetAtTime(y, now, smooth);
  pz.setTargetAtTime(z, now, smooth);
}

function movePanner(panner, x, y, z, now, smooth) {
  if (panner.positionX) {
    ramp3(panner.positionX, panner.positionY, panner.positionZ, x, y, z, now, smooth);
  } else {
    panner.setPosition(x, y, z);
  }
}

class SketchAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.voices = [];
    this.samples = [];
    this.sampleIndex = 0;

    this.volume = 0.7;
    this.swish = 1;
    this.spin = 1;
    this.impact = 1;
    this.reverb = 0.5;
    this.reverbSize = 3.5;
    this.fade = 0.35;
    this.watchdog = 0.25;
    this.active = true;
    this.suspendTimer = null;
    this.reverbApplied = -1;

    this.maxSpeed = 8;
    this.maxSpin = 40;
    this.tone = 1;
    this.impactDecay = 0.7;
    this.impactPitch = 1.6;
    this.hitGap = 0.09;
    this.lastHit = -1e9;
    this.lastImpulse = 0;

    this.spatial = 1;
    this.doppler = 1;
    this.panningModel = "equalpower";
    this.impactVoices = [];
    this.impactIndex = 0;
    this.speedOfSound = 40;
    this.refDistance = 1;
    this.rolloff = 0.5;
    this.nominalDistance = 3.1;

    this.listenerPosition = [0, 0, 4];
    this.listenerForward = [0, 0, -1];
    this.listenerVelocity = [0, 0, 0];
  }

  setListener(position, forward, up, velocity) {
    this.listenerPosition = position;
    this.listenerForward = forward;
    if (velocity) this.listenerVelocity = velocity;
    if (!this.ready) return;

    const l = this.ctx.listener;
    const now = this.ctx.currentTime;

    if (l.positionX) {
      ramp3(l.positionX, l.positionY, l.positionZ, ...position, now, 0.02);
      ramp3(l.forwardX, l.forwardY, l.forwardZ, ...forward, now, 0.02);
      ramp3(l.upX, l.upY, l.upZ, ...up, now, 0.02);
    } else {
      l.setPosition(...position);
      l.setOrientation(...forward, ...up);
    }
  }

  makePanner() {
    const panner = this.ctx.createPanner();
    panner.panningModel = this.panningModel;
    panner.distanceModel = "inverse";
    panner.refDistance = this.refDistance;
    panner.maxDistance = 200;
    panner.rolloffFactor = this.rolloff;
    return panner;
  }

  placePanner(panner, x, y, z, vx, vy, vz, now, smooth) {
    const l = this.listenerPosition;
    const f = this.listenerForward;

    const dx = x - l[0];
    const dy = y - l[1];
    const dz = z - l[2];
    const dist = Math.hypot(dx, dy, dz);

    if (dist <= 1e-4) {
      movePanner(panner, x, y, z, now, smooth);
      return 1;
    }

    const ux = dx / dist;
    const uy = dy / dist;
    const uz = dz / dist;

    const a = this.spatial;
    const mx = f[0] + (ux - f[0]) * a;
    const my = f[1] + (uy - f[1]) * a;
    const mz = f[2] + (uz - f[2]) * a;
    const ml = Math.hypot(mx, my, mz) || 1;

    movePanner(
      panner,
      l[0] + (mx / ml) * dist,
      l[1] + (my / ml) * dist,
      l[2] + (mz / ml) * dist,
      now,
      smooth,
    );

    const lv = this.listenerVelocity;
    const vr = ux * (vx - lv[0]) + uy * (vy - lv[1]) + uz * (vz - lv[2]);
    const c = this.speedOfSound;
    const shift = c / Math.max(c + vr * this.doppler, c * 0.2);
    return Math.min(2.5, Math.max(0.4, shift));
  }


  async start(sampleUrls = []) {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      console.warn("audio: no AudioContext available");
      return;
    }

    const ctx = new Ctor();
    this.ctx = ctx;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.08;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;

    const r = this.refDistance;
    const nominal =
      r / (r + this.rolloff * Math.max(this.nominalDistance - r, 0));

    this.bus = ctx.createGain();
    this.bus.gain.value = 1 / nominal;

    this.impactBus = ctx.createGain();
    this.impactBus.gain.value = 1 / nominal;

    this.impactComp = ctx.createDynamicsCompressor();
    this.impactComp.threshold.value = -6;
    this.impactComp.ratio.value = 3;
    this.impactComp.attack.value = 0.003;
    this.impactComp.release.value = 0.15;

    this.mix = ctx.createGain();
    this.mix.gain.value = 1;

    this.bus.connect(this.mix);
    this.impactBus.connect(this.impactComp);
    this.impactComp.connect(this.mix);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;

    this.damp = ctx.createBiquadFilter();
    this.damp.type = "lowpass";
    this.damp.frequency.value = 5200;

    this.lowCut = ctx.createBiquadFilter();
    this.lowCut.type = "highpass";
    this.lowCut.frequency.value = 180;

    this.predelay = ctx.createDelay(0.5);
    this.predelay.delayTime.value = 0.03;

    this.convolver = ctx.createConvolver();
    this.convolver.normalize = true;

    this.wet = ctx.createGain();
    this.wet.gain.value = 0;

    this.mix.connect(this.dry);
    this.dry.connect(this.limiter);

    this.mix.connect(this.lowCut);
    this.lowCut.connect(this.damp);
    this.damp.connect(this.predelay);
    this.predelay.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.wet.connect(this.limiter);

    this.reverbCache = new Map();
    this.setReverbSize(this.reverbSize);

    this.limiter.connect(this.master);
    this.master.connect(ctx.destination);

    this.noise = [];
    for (let i = 0; i < NOISE_BUFFERS; i++) {
      this.noise.push(makeNoise(ctx, NOISE_SECONDS));
    }

    for (const url of sampleUrls) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.arrayBuffer();
        this.samples.push(await ctx.decodeAudioData(data));
      } catch (e) {
        console.warn(`audio: could not load ${url}`, e);
      }
    }

    this.ready = true;
    console.log(
      `audio ready: ctx ${ctx.state}, ${ctx.sampleRate}Hz, ${this.samples.length} impact samples`,
    );
  }

  makeImpulse(seconds) {
    const ctx = this.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;

      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.exp(-5 * t) * (1 - t);
        const k = Math.pow(0.06, t);
        lp += (Math.random() * 2 - 1 - lp) * k;
        data[i] = lp * env;
      }

      const taps = 7;
      for (let j = 0; j < taps; j++) {
        const at = Math.floor(
          ctx.sampleRate * (0.005 + Math.random() * 0.055),
        );
        if (at < length) {
          data[at] += (Math.random() * 2 - 1) * 0.55 * (1 - j / taps);
        }
      }
    }

    return buffer;
  }

  arm(now) {
    const g = this.master.gain;
    const tau = Math.max(this.fade, 0.005) / 3;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this.active ? this.volume : 0, now, tau);
    g.setTargetAtTime(0, now + this.watchdog, Math.min(tau, 0.05));
  }

  setActive(active) {
    if (this.active === active) return;
    this.active = active;
    if (!this.ready) return;

    clearTimeout(this.suspendTimer);
    this.suspendTimer = null;

    if (active) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      this.arm(this.ctx.currentTime);
      return;
    }

    const tau = Math.max(this.fade, 0.005) / 3;
    const g = this.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(0, this.ctx.currentTime, tau);

    this.suspendTimer = setTimeout(
      () => {
        this.suspendTimer = null;
        if (!this.active && this.ctx.state === "running") {
          this.ctx.suspend().catch(() => {});
        }
      },
      (this.fade + 0.15) * 1000,
    );
  }

  setReverbSize(seconds) {
    if (!this.ctx || !this.convolver) return;
    const size = Math.max(0.2, Math.min(seconds, 10));
    const key = size.toFixed(1);
    if (key === this.reverbApplied) return;

    let buffer = this.reverbCache.get(key);
    if (!buffer) {
      buffer = this.makeImpulse(Number(key));
      this.reverbCache.set(key, buffer);
    }

    this.convolver.buffer = buffer;
    this.predelay.delayTime.value = Math.min(0.09, 0.012 + size * 0.012);
    this.reverbApplied = key;
  }

  setVoiceCount(n) {
    if (!this.ready) return;
    while (this.voices.length > n) this.removeVoice();
    while (this.voices.length < n) this.addVoice();
  }

  addVoice() {
    const ctx = this.ctx;
    const buffer = this.noise[this.voices.length % this.noise.length];

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const swishFilter = ctx.createBiquadFilter();
    swishFilter.type = "bandpass";
    swishFilter.Q.value = 3;
    swishFilter.frequency.value = 400;

    const swishGain = ctx.createGain();
    swishGain.gain.value = 0;

    const spinFilter = ctx.createBiquadFilter();
    spinFilter.type = "bandpass";
    spinFilter.Q.value = 8;
    spinFilter.frequency.value = 900;

    const spinGain = ctx.createGain();
    spinGain.gain.value = 0;

    const tremolo = ctx.createGain();
    tremolo.gain.value = 1;

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 1;

    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0;

    lfo.connect(lfoDepth);
    lfoDepth.connect(tremolo.gain);

    const panner = this.makePanner();
    panner.connect(this.bus);

    source.connect(swishFilter);
    swishFilter.connect(swishGain);
    swishGain.connect(panner);

    source.connect(spinFilter);
    spinFilter.connect(spinGain);
    spinGain.connect(tremolo);
    tremolo.connect(panner);

    source.start(this.ctx.currentTime, Math.random() * NOISE_SECONDS);
    lfo.start();

    this.voices.push({
      source,
      swishFilter,
      swishGain,
      spinFilter,
      spinGain,
      lfo,
      lfoDepth,
      panner,
    });
  }

  removeVoice() {
    const v = this.voices.pop();
    if (!v) return;
    try {
      v.source.stop();
      v.lfo.stop();
    } catch (e) {
      void e;
    }
    v.swishGain.disconnect();
    v.spinGain.disconnect();
    v.panner.disconnect();
  }

  update(states) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const smooth = 0.04;

    this.arm(now);
    this.setReverbSize(this.reverbSize);
    this.wet.gain.setTargetAtTime(this.reverb * 1.6, now, smooth);
    this.dry.gain.setTargetAtTime(1 - this.reverb * 0.35, now, smooth);

    for (let i = 0; i < this.voices.length && i < states.length; i++) {
      const v = this.voices[i];
      const s = states[i];

      const speed = Math.min(s.speed / this.maxSpeed, 1);
      const spin = Math.min(s.spin / this.maxSpin, 1);
      const shift = this.placePanner(
        v.panner,
        s.x,
        s.y,
        s.z,
        s.vx,
        s.vy,
        s.vz,
        now,
        smooth,
      );
      const bend = s.pitch * shift;

      v.swishFilter.frequency.setTargetAtTime(
        (90 + speed * 700) * this.tone * bend,
        now,
        smooth,
      );
      v.swishGain.gain.setTargetAtTime(
        Math.pow(speed, 1.5) * 4 * this.swish,
        now,
        smooth,
      );

      v.spinFilter.frequency.setTargetAtTime(
        (150 + spin * 850) * this.tone * bend,
        now,
        smooth,
      );
      v.spinGain.gain.setTargetAtTime(
        Math.pow(spin, 1.5) * 3 * this.spin,
        now,
        smooth,
      );
      v.lfo.frequency.setTargetAtTime(
        Math.min(24, Math.max(0.5, (s.spin / Math.PI) * 2)),
        now,
        smooth,
      );
      v.lfoDepth.gain.setTargetAtTime(spin * 0.8, now, smooth);
    }
  }

  hit(impulse, pitch = 1, at = null, velocity = null) {
    if (!this.ready || !this.samples.length || this.impact <= 0) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (now - this.lastHit < this.hitGap && impulse < this.lastImpulse * 2) {
      return;
    }
    this.lastHit = now;
    this.lastImpulse = impulse;

    const level = Math.min(impulse, 1);
    const loudness = Math.pow(level, 0.5);

    let shift = 1;
    const panner = this.takeImpactPanner();
    if (at) {
      shift = this.placePanner(
        panner,
        at[0],
        at[1],
        at[2],
        velocity ? velocity[0] : 0,
        velocity ? velocity[1] : 0,
        velocity ? velocity[2] : 0,
        now,
        0.001,
      );
    } else {
      const l = this.listenerPosition;
      const f = this.listenerForward;
      const r = this.refDistance;
      this.placePanner(
        panner,
        l[0] + f[0] * r,
        l[1] + f[1] * r,
        l[2] + f[2] * r,
        0,
        0,
        0,
        now,
        0.001,
      );
    }

    const source = ctx.createBufferSource();
    source.buffer = this.samples[this.sampleIndex % this.samples.length];
    this.sampleIndex++;
    source.playbackRate.value =
      this.impactPitch * pitch * shift * (0.92 + Math.random() * 0.16);

    const body = ctx.createBiquadFilter();
    body.type = "highpass";
    body.frequency.value = 120;

    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 1600 + loudness * 7000;

    const peak = Math.max(loudness * 2 * this.impact, 1e-4);
    const decay = this.impactDecay;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(peak * 0.0005, now + decay);

    source.connect(body);
    body.connect(tone);
    tone.connect(gain);
    gain.connect(panner);

    source.start(now);
    source.stop(now + decay + 0.02);
    source.onended = () => {
      gain.disconnect();
      tone.disconnect();
      body.disconnect();
    };
  }

  stats(out) {
    out.ready = this.ready;
    out.state = this.ctx ? this.ctx.state : "off";
    out.sampleRate = this.ctx ? this.ctx.sampleRate : 0;
    out.latency = this.ctx ? (this.ctx.baseLatency ?? 0) * 1000 : 0;
    out.voices = this.voices.length;
    out.impactPanners = this.impactVoices.length;
    out.limiter = this.limiter ? -this.limiter.reduction : 0;
    out.impactComp = this.impactComp ? -this.impactComp.reduction : 0;
    out.reverbTail = this.convolver?.buffer
      ? this.convolver.buffer.duration
      : 0;

    let loudest = 0;
    let spin = 0;
    for (const v of this.voices) {
      loudest = Math.max(loudest, v.swishGain.gain.value);
      spin = Math.max(spin, v.spinGain.gain.value);
    }
    out.swish = loudest;
    out.spin = spin;
    return out;
  }

  configure(settings) {
    this.volume = settings.volume;
    this.fade = settings.fade;
    this.swish = settings.swish;
    this.spin = settings.spin;
    this.impact = settings.impact;
    this.tone = settings.tone;
    this.impactDecay = settings.impactDecay;
    this.impactPitch = settings.impactPitch;
    this.spatial = settings.spatial;
    this.doppler = settings.doppler;
    this.reverb = settings.reverb;
    this.reverbSize = settings.reverbSize;
    this.setPanningModel(settings.panningModel);
  }

  setPanningModel(model) {
    if (model === this.panningModel) return;
    this.panningModel = model;
    if (!this.ready) return;
    for (const v of this.voices) v.panner.panningModel = model;
    for (const p of this.impactVoices) p.panningModel = model;
  }

  takeImpactPanner() {
    if (this.impactVoices.length < IMPACT_PANNERS) {
      const panner = this.makePanner();
      panner.connect(this.impactBus);
      this.impactVoices.push(panner);
      return panner;
    }

    const panner = this.impactVoices[this.impactIndex % IMPACT_PANNERS];
    this.impactIndex++;
    return panner;
  }
}

export { SketchAudio };
