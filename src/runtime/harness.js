/**
 * The verification surface.
 *
 * `window.__arcade` is how a script drives and inspects a running game. It
 * ships in the production bundle on purpose: every claim this project makes
 * about itself — the frame times, the input latency, the fact that a run
 * actually changes state — is reproducible by anyone who opens devtools on the
 * live site and runs the same calls the repository's own tests run. A receipt
 * only somebody's CI can produce is not a receipt.
 *
 * It reads and drives. It sends nothing anywhere; there is no network code in
 * this file or anywhere it can reach.
 */

export function installHarness(shell) {
  const api = {
    version: 1,
    get ready() {
      return !!shell.app;
    },
    /** Shell state plus whatever the game chooses to expose. */
    state() {
      return {
        shell: shell.state,
        mode: shell.mode,
        seed: shell.seed,
        game: shell.manifest.id,
        elapsedMs:
          shell.state === "playing" ? performance.now() - shell.startedAt : 0,
        simulatedMs: shell.loop.simulatedMs,
        steps: shell.loop.steps,
        frames: shell.loop.frames,
        holdDown: shell.input.down("hold"),
        snapshot: shell.game?.snapshot?.() ?? null,
        result: shell.result,
      };
    },
    /** Begin a run with a fixed seed so the run is reproducible. */
    start(opts = {}) {
      shell.start(opts);
      return api.state();
    },
    pause: () => shell.pause(),
    resume: () => shell.resume(),
    /** Fast-forward. The simulation still runs every fixed step; only the rate
     *  that wall-clock time is fed into the accumulator changes. A run at
     *  scale 6 executes the same steps as a run at scale 1. */
    setTimeScale(n) {
      shell.loop.timeScale = Math.max(0.1, Math.min(20, Number(n) || 1));
      return shell.loop.timeScale;
    },
    frameStats: () => shell.loop.frameStats(),
    resetFrameStats: () => shell.loop.resetFrameStats(),
    /** In-page input-latency proxy: press timestamp to the first rendered
     *  frame on which the game's verb state had actually moved. This is NOT a
     *  photometric press-to-photon measurement and must never be reported as
     *  one. */
    latency() {
      const s = [...shell.latency.samples].sort((a, b) => a - b);
      if (!s.length) return null;
      const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
      return {
        method: "press-to-first-changed-rendered-frame (in-page proxy)",
        samples: s.length,
        median: at(0.5),
        p95: at(0.95),
        max: s[s.length - 1],
      };
    },
    audio() {
      return {
        unlocked: shell.audio.unlocked,
        cuesPlayed: shell.audio.playCount,
        ctxState: shell.audio.ctx?.state ?? "none",
      };
    },
    settings: () => ({ ...shell.settings }),
    setSetting(key, value) {
      shell.save.set("settings." + key, value);
      shell.audio.applySettings();
      shell.game?.settingsChanged?.();
      return { ...shell.settings };
    },
    motion: () => ({
      reduced: shell.motion.reduced,
      shakeScale: shell.motion.shakeScale,
      flashAllowed: shell.motion.flashAllowed,
      trauma: +shell.motion.trauma.toFixed(4),
      peakOffset: +shell.motion.peakOffset.toFixed(3),
      offsetX: +shell.motion.offsetX.toFixed(3),
      offsetY: +shell.motion.offsetY.toFixed(3),
    }),
    resetMotionPeak() {
      shell.motion.peakOffset = 0;
      return true;
    },
    storageKeys: () => shell.save.inventory(),
    eraseEverything: () => shell.save.eraseEverything(),
    saveRecovery: () => shell.save.lastRecovery,
  };
  globalThis.__arcade = api;
  return api;
}
