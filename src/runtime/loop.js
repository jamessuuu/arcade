/**
 * The house loop. Fixed-timestep simulation, interpolated render.
 *
 * Why fixed timestep and not `delta * speed`: a variable-delta update produces
 * different game state at 30fps and at 144fps. Two players on two machines do
 * not play the same game, replays do not reproduce, and the physics gets
 * springy on a bad frame. This is pack row G1 and the loop is written to pass
 * it, not to be argued about later.
 *
 * The accumulator is CLAMPED. Without a clamp, a tab that was backgrounded for
 * thirty seconds returns with 30,000ms of simulation owed, the loop tries to
 * pay it in one frame, and the page locks up — the classic spiral of death.
 * We drop the debt instead: the player was not looking.
 *
 * Instrumentation is built in rather than bolted on, because "measure it, do
 * not invent it" is a house rule and a loop that cannot report its own frame
 * times makes the rule impossible to keep.
 */

export const STEP_MS = 1000 / 60; // the one simulation rate. 60Hz.

export class Loop {
  /**
   * @param {(stepSeconds:number)=>void} update  fixed-step simulation
   * @param {(alpha:number, frameMs:number)=>void} render  alpha is 0..1 between
   *        the last two simulation states, for interpolation
   */
  constructor(update, render) {
    this.update = update;
    this.render = render;

    this.running = false;
    this.accumulator = 0;
    this.lastTime = 0;
    this.timeScale = 1;
    /** Wall-clock ms of simulation actually executed. Not frame time. */
    this.simulatedMs = 0;
    this.steps = 0;
    this.frames = 0;

    /** Ring buffer of frame intervals in ms. 600 frames ≈ 10s at 60Hz. */
    this._frameTimes = new Float32Array(600);
    this._frameIdx = 0;
    this._frameCount = 0;

    /** Cumulative, never overwritten by the ring buffer. The ring holds the
     *  last 600 frames, which is a window, and a window can miss the one stall
     *  that matters. These counters cover every unpaused frame of a whole run,
     *  which is what pack row G2 actually asks about. */
    this.runFrames = 0;
    this.runOver33 = 0;
    this.runOver167 = 0;
    this.runWorstMs = 0;

    this._raf = 0;
    this._tick = this._tick.bind(this);
    this._onVisibility = () => {
      // Returning from a hidden tab: throw away the debt rather than pay it.
      if (!document.hidden) this.lastTime = performance.now();
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    document.addEventListener("visibilitychange", this._onVisibility);
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    document.removeEventListener("visibilitychange", this._onVisibility);
  }

  /** Paused loops still render (so a pause screen is not a frozen artifact of
   *  a dead canvas) but run zero simulation steps. */
  setPaused(paused) {
    this.paused = paused;
    if (!paused) this.lastTime = performance.now();
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    let frameMs = now - this.lastTime;
    this.lastTime = now;
    if (frameMs < 0) frameMs = 0;

    this.frames++;
    this._frameTimes[this._frameIdx] = frameMs;
    this._frameIdx = (this._frameIdx + 1) % this._frameTimes.length;
    if (this._frameCount < this._frameTimes.length) this._frameCount++;

    if (this.paused) {
      this.render(1, frameMs);
      return;
    }

    // Counted only while actually running: a long frame with a menu open is
    // not a stutter anybody experiences.
    this.runFrames++;
    if (frameMs > 33) this.runOver33++;
    if (frameMs > 16.7) this.runOver167++;
    if (frameMs > this.runWorstMs) this.runWorstMs = frameMs;

    // Clamp. At timeScale 1 we will pay at most 5 steps (~83ms) of debt in one
    // frame; beyond that the debt is forgiven. The clamp scales with timeScale
    // so a fast-forwarded harness run is not silently throttled into a
    // different game than the one a human plays.
    const maxDebt = STEP_MS * 5 * Math.max(1, this.timeScale);
    this.accumulator += Math.min(frameMs * this.timeScale, maxDebt);

    let guard = 0;
    while (this.accumulator >= STEP_MS && guard < 240) {
      this.update(STEP_MS / 1000);
      this.accumulator -= STEP_MS;
      this.simulatedMs += STEP_MS;
      this.steps++;
      guard++;
    }

    this.render(this.accumulator / STEP_MS, frameMs);
  }

  /** Frame-time statistics over the ring buffer. Returns null before there is
   *  enough data to say anything, because a made-up number is worse than none. */
  frameStats() {
    if (this._frameCount < 30) return null;
    const arr = Array.from(this._frameTimes.slice(0, this._frameCount)).sort(
      (a, b) => a - b,
    );
    const at = (q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
    return {
      window: {
        samples: arr.length,
        p50: +at(0.5).toFixed(2),
        p95: +at(0.95).toFixed(2),
        max: +arr[arr.length - 1].toFixed(2),
        over33: arr.filter((v) => v > 33).length,
        over16_7: arr.filter((v) => v > 16.7).length,
      },
      wholeRun: {
        frames: this.runFrames,
        over33: this.runOver33,
        over16_7: this.runOver167,
        worstMs: +this.runWorstMs.toFixed(2),
      },
    };
  }

  resetFrameStats() {
    this._frameIdx = 0;
    this._frameCount = 0;
    this.runFrames = 0;
    this.runOver33 = 0;
    this.runOver167 = 0;
    this.runWorstMs = 0;
  }
}
