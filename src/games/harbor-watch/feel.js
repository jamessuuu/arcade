/**
 * HARBOR WATCH — feel constants.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THESE NUMBERS BELONG TO JAMES.
 *
 * The program's protocol is explicit: agents implement the mechanism and
 * expose the numbers; James turns them against a running build, because a feel
 * claim is only valid against a running build with a human hand on it. Every
 * value below is a first guess by the agent that wrote the mechanism, and not
 * one of them has been validated by a person playing this game. They are
 * starting positions, not settings.
 *
 * When a value changes, add a row to the table in docs/FEEL-LOG.md saying what
 * changed, to what, and what it fixed. That log is the actual deliverable of a
 * tuning session; the diff is not.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const FEEL = {
  // --- The verb ------------------------------------------------------------
  /** Seconds for the boom to travel from fully down to fully up while held.
   *  This is the game's whole tension budget. Too fast and the verb has no
   *  weight and no commitment; too slow and a correct decision still loses the
   *  ship, which is the one failure players will call unfair. */
  gateRaiseSeconds: 0.3,
  /** Seconds to fall back down on release. Slightly quicker than the raise:
   *  gravity helps it down, and a slow drop punishes a correct close. */
  gateLowerSeconds: 0.26,
  /** Openness (0..1) at which the boom bar has physically cleared the tallest
   *  hull. The pass/refuse test uses this exact number, so what the player sees
   *  is what the rule does. Changing it without changing BOOM_TRAVEL in art.js
   *  makes the game lie. */
  passThreshold: 0.45,

  // --- Approach ------------------------------------------------------------
  /** Virtual px/second a vessel makes along the channel at pace 1.0. */
  shipSpeed: 196,
  /** The shortest gap the spawner is ever allowed to produce, in seconds.
   *  ACCESSIBILITY FLOOR: the accessibility contract forbids a mechanic that
   *  needs an input faster than ~200ms. With a 0.26s close, 0.9s between
   *  vessels leaves well over half a second of decision time in the worst
   *  case. tests/spawn-floor.mjs asserts no generated schedule violates it. */
  minGapSeconds: 0.9,
  /** How long a vessel's pennant must be readable before it reaches the boom,
   *  at the very foggiest. Also asserted by tests/spawn-floor.mjs. */
  minReadableSeconds: 1.4,

  // --- Impact recipe (section 6, item 4) -----------------------------------
  /** Simulation freeze on letting a decoy through. The single most effective
   *  item in the recipe and the only one that stays on under reduced motion,
   *  because it is the absence of motion. */
  hitstopWrongAdmit: 0.09,
  hitstopWrongRefuse: 0.04,
  /** Trauma added, 0..1. Squared before it becomes an offset, and scaled by
   *  the player's shake setting, so 0 on the slider means literally zero.
   *
   *  RAISED from 0.42/0.16/0.05 after measurement. Because trauma is SQUARED,
   *  0.42 produced a peak camera displacement of 0.45 pixels — a shake nobody
   *  would ever see, and therefore a juice item that cost code and delivered
   *  nothing. The squaring is right (it keeps small events subtle and stops
   *  overlapping events stacking into a strobe); the inputs were simply on the
   *  wrong scale for it. tests/mechanics.mjs now samples peak displacement
   *  through a run instead of reading it once, so this cannot regress
   *  silently back to invisible. */
  traumaWrongAdmit: 0.85,
  traumaWrongRefuse: 0.5,
  traumaCorrectAdmit: 0.22,
  /** Frames-equivalent of the white pop on a correct admit, in seconds. */
  flashSeconds: 0.09,
  /** Lantern pop: how far past full size it overshoots, and how long. */
  lanternPopScale: 1.55,
  lanternPopSeconds: 0.26,
  /** Squash on the boom when it slams shut. */
  boomSlamSquash: 0.22,
  boomSlamSeconds: 0.14,

  /** Traffic comes in bursts and lulls, not on a metronome. With this
   *  probability a gap is stretched by `lullScale`, so there are stretches
   *  where nothing happens at all.
   *
   *  This is the single most important pacing number in the game and it was
   *  added after the first driven run: even spacing produced 75 decisions in
   *  180 seconds with no gap longer than 3 seconds, which is a rhythm game
   *  wearing a vigilance game's clothes. Attention only has somewhere to drift
   *  if the game sometimes stops asking for it — and a lapse is only
   *  interesting if it happens in the quiet and gets caught by the next burst. */
  lullChance: 0.22,
  lullScaleMin: 1.9,
  lullScaleMax: 2.9,

  // --- Ambience ------------------------------------------------------------
  wakeParticleCount: 7,
  moonGlitterCount: 34,
  fogBandCount: 5,
  starCount: 46,
  /** Seconds of sky transition into dawn at the end of a shift. */
  dawnSeconds: 7,

  // --- Audio ---------------------------------------------------------------
  cueGainAdmit: 0.3,
  cueGainRefuse: 0.26,
  cueGainWrong: 0.4,
  cueGainLamp: 0.34,
};

/**
 * Modes. Three per game is a runtime-wide constraint from the program: one
 * product for kids and for adults, never two products.
 *
 * `pace` scales ship speed. `gap` scales spacing. Everything else is per-watch.
 */
export const MODES = {
  gentle: {
    id: "gentle",
    name: "Gentle",
    description:
      "Slow water, no fog, and the lamp never changes. Nothing is lost if you miss one.",
    pace: 0.74,
    gapScale: 1.0,
    /** Gentle genuinely never changes the rule — not even at a watch bell.
     *  Without this the shared generator changes the lamp at every watch
     *  boundary, and the mode's own description would be a lie. */
    steadyLamp: true,
    forgiving: true, // decoys that get in do not darken the harbour
    watches: [
      { seconds: 52, shapes: 3, fog: 0, gap: 3.9, hollow: false, lampChanges: 0 },
      { seconds: 58, shapes: 3, fog: 0, gap: 3.6, hollow: false, lampChanges: 0 },
    ],
  },
  standard: {
    id: "standard",
    name: "Standard",
    description:
      "Three watches, fog after the first bell, and the lamp changes while you are busy.",
    pace: 1,
    gapScale: 1,
    forgiving: false,
    watches: [
      { seconds: 55, shapes: 3, fog: 0, gap: 3.2, hollow: false, lampChanges: 0 },
      { seconds: 60, shapes: 4, fog: 0.45, gap: 2.9, hollow: false, lampChanges: 1 },
      { seconds: 65, shapes: 5, fog: 0.7, gap: 2.6, hollow: true, lampChanges: 2 },
    ],
  },
  long: {
    id: "long",
    name: "Long watch",
    description:
      "Five watches and about six minutes. The same rules, held for longer.",
    pace: 1.06,
    gapScale: 0.95,
    forgiving: false,
    watches: [
      { seconds: 58, shapes: 3, fog: 0, gap: 3.2, hollow: false, lampChanges: 0 },
      { seconds: 62, shapes: 4, fog: 0.35, gap: 2.9, hollow: false, lampChanges: 1 },
      { seconds: 66, shapes: 5, fog: 0.6, gap: 2.7, hollow: true, lampChanges: 1 },
      { seconds: 70, shapes: 5, fog: 0.75, gap: 2.5, hollow: true, lampChanges: 2 },
      { seconds: 74, shapes: 6, fog: 0.85, gap: 2.4, hollow: true, lampChanges: 2 },
    ],
  },
};
