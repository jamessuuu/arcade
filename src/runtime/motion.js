/**
 * Motion, shake and flash — one place, honoured at runtime.
 *
 * Pack row G8 asks for toggles that are "present AND honoured at runtime",
 * which is the difference between a settings screen and an accessibility
 * feature. Nothing in a game reads `prefers-reduced-motion` directly; games
 * ask this module how much shake they are allowed and get a number, so a
 * single switch genuinely turns everything off.
 *
 * Shake is TRAUMA-based, not "shake for 200ms". Trauma is a 0..1 reservoir
 * that events add to and that decays continuously; offset is trauma squared,
 * so small events barely register and big ones hit hard, and overlapping
 * events never stack into a seizure. The cap is absolute.
 */

const MAX_OFFSET_PX = 14;
const MAX_ROT_RAD = 0.018;

export class Motion {
  constructor(settings, rng) {
    this.settings = settings;
    this.rng = rng;
    this.trauma = 0;
    this.decayPerSecond = 1.7;
    this.time = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.rotation = 0;
    /** Largest displacement seen since the last reset. Tracked in here rather
     *  than sampled from outside, because trauma decays inside a quarter of a
     *  second and a test polling across a process boundary lands in the gaps
     *  between events — which made a real "the shake is invisible" defect look
     *  like an intermittent test. */
    this.peakOffset = 0;

    this._mq =
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.systemPrefersReduced = !!this._mq?.matches;
    this._mq?.addEventListener?.("change", (e) => {
      this.systemPrefersReduced = e.matches;
    });
  }

  /** True when animation should be minimised. `auto` follows the OS. */
  get reduced() {
    const s = this.settings.motion;
    if (s === "reduced") return true;
    if (s === "full") return false;
    return this.systemPrefersReduced;
  }

  /** 0..1. Zero when reduced motion is on, regardless of the slider — the
   *  stronger signal wins, which is the correct direction to fail. */
  get shakeScale() {
    if (this.reduced) return 0;
    const v = Number(this.settings.shake);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
  }

  /** Full-screen brightness pops. Off under reduced motion AND off when the
   *  player turned them off, because photosensitivity is not a preference. */
  get flashAllowed() {
    return !this.reduced && this.settings.flash !== false;
  }

  /** Add trauma. `amount` is 0..1; callers pass small numbers. */
  addTrauma(amount) {
    this.trauma = Math.min(1, this.trauma + amount * this.shakeScale);
  }

  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - this.decayPerSecond * dt);
    const t = this.trauma * this.trauma;
    if (t <= 0) {
      this.offsetX = this.offsetY = this.rotation = 0;
      return;
    }
    // Smooth pseudo-noise rather than per-frame random, so the camera drifts
    // instead of strobing. Strobing is both uglier and less safe.
    const n = (seed) =>
      Math.sin(this.time * 43.7 + seed) * Math.cos(this.time * 27.3 + seed * 2);
    this.offsetX = n(1.3) * MAX_OFFSET_PX * t;
    this.offsetY = n(5.7) * MAX_OFFSET_PX * t;
    this.rotation = n(9.1) * MAX_ROT_RAD * t;
    const mag = Math.abs(this.offsetX) + Math.abs(this.offsetY);
    if (mag > this.peakOffset) this.peakOffset = mag;
  }

  reset() {
    this.trauma = 0;
    this.offsetX = this.offsetY = this.rotation = 0;
    this.peakOffset = 0;
  }

  /** Duration multiplier for tweens: 0 collapses an animation to an instant
   *  cut, which is what reduced motion should do to a transition. */
  get animScale() {
    return this.reduced ? 0 : 1;
  }
}

/**
 * Hitstop. Freezing the simulation for a few frames on impact is the cheapest
 * and most effective single item in the juice recipe, and unlike shake it is
 * not a motion-sensitivity problem — it is the absence of motion — so it stays
 * on under reduced motion.
 */
export class Hitstop {
  constructor() {
    this.remaining = 0;
  }
  hit(seconds) {
    this.remaining = Math.max(this.remaining, seconds);
  }
  /** Returns true if the simulation should skip this step. */
  consume(dt) {
    if (this.remaining <= 0) return false;
    this.remaining -= dt;
    return true;
  }
  reset() {
    this.remaining = 0;
  }
}
