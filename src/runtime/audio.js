/**
 * The house audio spine. Every sound in this project is SYNTHESISED at run
 * time from oscillators and filtered noise. There is not one audio file in the
 * repository.
 *
 * That is a deliberate trade, and here is what it buys:
 *   - The licence ledger for audio is empty, and empty is the only ledger that
 *     cannot be wrong. No CC-BY row that never renders, no sample pack with a
 *     non-commercial clause discovered at release.
 *   - Zero bytes against the 2MB first-load budget for a full cue set.
 *   - Variance is free. Every cue is generated fresh, so a pitch and gain
 *     jitter stops repeated cues machine-gunning, which is the single most
 *     common way a game's audio starts to feel cheap.
 * What it costs: no recorded voice, no real instruments, no music that sounds
 * played rather than built. Release 1 ships no speech at all, which is also
 * why there is no captioning question to defer.
 *
 * Three player-facing buses, because a player who wants the ambience down and
 * the cues up must be able to have that: effects, ambience, ui.
 * Nothing here starts before a real user gesture (browser autoplay policy),
 * and the game is fully playable with the context never unlocked at all.
 */

export class AudioBus {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.buses = {};
    this.unlocked = false;
    this.ambienceNodes = null;
    this.playCount = 0;
    this.muted = false;
  }

  /** Called from a real gesture handler. Safe to call repeatedly. */
  unlock() {
    if (this.unlocked) return true;
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return false;
    try {
      this.ctx = new Ctx();
    } catch {
      return false;
    }

    // A limiter on the master bus. Synthesised cues stack unpredictably and a
    // clipped transient is the difference between "impact" and "broken".
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(limiter);

    for (const name of ["effects", "ambience", "ui"]) {
      const g = this.ctx.createGain();
      g.gain.value = 1;
      g.connect(this.master);
      this.buses[name] = g;
    }

    this.unlocked = true;
    this.applySettings();
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return true;
  }

  applySettings() {
    if (!this.unlocked) return;
    const s = this.settings;
    const clamp = (v, d) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d;
    };
    this.master.gain.value = this.muted ? 0 : 0.75 * clamp(s.volumeMaster, 0.8);
    this.buses.effects.gain.value = clamp(s.volumeEffects, 1);
    this.buses.ui.gain.value = clamp(s.volumeEffects, 1) * 0.8;
    this.buses.ambience.gain.value = clamp(s.volumeAmbience, 0.7);
  }

  setMuted(m) {
    this.muted = m;
    this.applySettings();
  }

  suspend() {
    if (this.unlocked && this.ctx.state === "running")
      this.ctx.suspend().catch(() => {});
  }
  resume() {
    if (this.unlocked && this.ctx.state === "suspended")
      this.ctx.resume().catch(() => {});
  }

  _env(node, { gain = 0.3, attack = 0.005, hold = 0, decay = 0.2, at }) {
    const t = at ?? this.ctx.currentTime;
    const g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    if (hold > 0) g.setValueAtTime(Math.max(0.0002, gain), t + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
    return t + attack + hold + decay;
  }

  /** One oscillator voice with an optional pitch slide and low-pass. */
  tone({
    freq = 440,
    to = null,
    type = "sine",
    gain = 0.3,
    attack = 0.005,
    hold = 0,
    decay = 0.25,
    bus = "effects",
    cutoff = null,
    delay = 0,
    detuneCents = 0,
  }) {
    if (!this.unlocked) return;
    const ctx = this.ctx;
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (to !== null)
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, to),
        at + attack + hold + decay,
      );
    if (detuneCents) osc.detune.setValueAtTime(detuneCents, at);

    const amp = ctx.createGain();
    let node = osc;
    if (cutoff !== null) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(cutoff, at);
      node.connect(f);
      node = f;
    }
    node.connect(amp);
    amp.connect(this.buses[bus] ?? this.buses.effects);
    const end = this._env(amp, { gain, attack, hold, decay, at });
    osc.start(at);
    osc.stop(end + 0.02);
    this.playCount++;
  }

  /** Filtered noise burst — the whole percussion section. */
  noise({
    dur = 0.2,
    gain = 0.25,
    type = "bandpass",
    freq = 900,
    to = null,
    q = 1,
    bus = "effects",
    attack = 0.003,
    delay = 0,
  }) {
    if (!this.unlocked) return;
    const ctx = this.ctx;
    const at = ctx.currentTime + delay;
    const frames = Math.max(1, Math.ceil(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, at);
    if (to !== null)
      filt.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    filt.Q.value = q;

    const amp = ctx.createGain();
    src.connect(filt);
    filt.connect(amp);
    amp.connect(this.buses[bus] ?? this.buses.effects);
    this._env(amp, { gain, attack, hold: 0, decay: dur, at });
    src.start(at);
    src.stop(at + dur + 0.02);
    this.playCount++;
  }

  /** Continuous sea/wind bed. One filtered noise source, slowly swept, so it
   *  breathes instead of hissing. */
  startAmbience() {
    if (!this.unlocked || this.ambienceNodes) return;
    const ctx = this.ctx;
    const frames = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Brown-ish noise: integrated white, which sounds like water rather than
    // like a broken radio.
    let last = 0;
    for (let i = 0; i < frames; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 620;
    filt.Q.value = 0.6;

    const swell = ctx.createGain();
    swell.gain.value = 0.34;

    // A very slow LFO on the filter gives the swell of water on a harbour wall.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain);
    lfoGain.connect(filt.frequency);

    src.connect(filt);
    filt.connect(swell);
    swell.connect(this.buses.ambience);
    src.start();
    lfo.start();
    this.ambienceNodes = { src, lfo, swell, filt };
  }

  stopAmbience() {
    if (!this.ambienceNodes) return;
    const { src, lfo, swell } = this.ambienceNodes;
    try {
      swell.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.25);
      src.stop(this.ctx.currentTime + 1.2);
      lfo.stop(this.ctx.currentTime + 1.2);
    } catch {
      /* already stopped */
    }
    this.ambienceNodes = null;
  }

  /** Ambience intensity 0..1 — fog and weather ride this. */
  setAmbienceIntensity(v) {
    if (!this.ambienceNodes) return;
    const t = this.ctx.currentTime;
    this.ambienceNodes.swell.gain.setTargetAtTime(
      0.2 + 0.35 * Math.max(0, Math.min(1, v)),
      t,
      0.5,
    );
  }
}

/** Slight, seeded-free jitter so a repeated cue is never bit-identical. */
export function vary(base, cents = 45, gainSpread = 0.12) {
  const semis = ((Math.random() * 2 - 1) * cents) / 100;
  return {
    freq: base * Math.pow(2, semis / 12),
    gainMul: 1 + (Math.random() * 2 - 1) * gainSpread,
  };
}
