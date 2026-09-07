/**
 * HARBOR WATCH — the shift generator.
 *
 * The whole shift is generated up front from the seed. That makes a run
 * reproducible from the number printed on the results screen, and — more
 * importantly — it means the FAIRNESS FLOORS can be checked against a finished
 * schedule instead of hoped for while the game runs.
 *
 * Pure: no PixiJS, no DOM, no clock. tests/spawn-floor.mjs builds a thousand
 * shifts with it in plain Node and asserts that not one of them ever asks a
 * player to decide faster than the accessibility contract allows.
 */

import { FEEL } from "./feel.js";
import { GEO, MARKS, HULL_IDS } from "./geometry.js";

/** What the lamp is showing at time t. */
export function lampAtTime(timeline, t) {
  let cur = timeline[0];
  for (const e of timeline) {
    if (e.t <= t) cur = e;
    else break;
  }
  return cur;
}

/** Absolute end time of watch `w`. */
function watchEndAt(mode, w) {
  let t = 0;
  for (let i = 0; i <= w; i++) t += mode.watches[i].seconds;
  return t;
}

export function buildSchedule(rng, mode) {
  const speed = FEEL.shipSpeed * mode.pace;
  const travel = (GEO.spawnX - GEO.boomX) / speed;

  /** [{ t, mark, hollow }] — what the lamp shows from time t onward. */
  const lampTimeline = [];
  /** [{ arriveAt, spawnAt, mark, hollow, hull, fog, watch }] */
  const vessels = [];

  // ---- PHASE 1: the lamp timeline, for the WHOLE shift, first. ----------
  //
  // Built before any arrival exists, because the guard below has to know about
  // every change including the ones at watch boundaries. The first version
  // interleaved the two and only guarded mid-watch changes, so the lamp could
  // change at a watch boundary and a vessel could arrive a millisecond later
  // to be judged against a rule the player had not yet seen. tests/
  // spawn-floor.mjs caught it at 0.001s on all three modes.
  let t = 0;
  let lampMark = null;
  for (let w = 0; w < mode.watches.length; w++) {
    const watch = mode.watches[w];
    const pool = MARKS.slice(0, watch.shapes).map((m) => m.id);
    const watchStart = t;

    // A watch always opens on a mark, and after the first watch that mark is
    // deliberately a DIFFERENT one: the bell and the lamp change together, so
    // the beat is loud and the habit built over the last minute is now wrong.
    if (mode.steadyLamp && lampMark) {
      // This mode holds one rule for the whole shift, so a watch boundary is
      // only a bell: no new entry, nothing for the player to re-learn.
      t += watch.seconds;
      continue;
    }
    const startPool = lampMark ? pool.filter((p) => p !== lampMark) : pool;
    lampMark = rng.pick(startPool.length ? startPool : pool);
    lampTimeline.push({
      t: watchStart,
      mark: lampMark,
      hollow: watch.hollow ? rng.chance(0.35) : false,
    });

    for (let i = 0; i < watch.lampChanges; i++) {
      const frac = (i + 1) / (watch.lampChanges + 1);
      const others = pool.filter((p) => p !== lampMark);
      lampMark = rng.pick(others.length ? others : pool);
      lampTimeline.push({
        t: watchStart + watch.seconds * frac,
        mark: lampMark,
        hollow: watch.hollow ? rng.chance(0.4) : false,
      });
    }
    t += watch.seconds;
  }
  const shiftSeconds = t;

  /** Every moment the rule changes. An arrival may never land inside the
   *  window that follows one of these. */
  const guardTimes = lampTimeline.filter((e) => e.t > 0).map((e) => e.t);

  // ---- PHASE 2: arrivals. ------------------------------------------------
  let clock = 2.2; // first arrival, so the channel is not full at second zero
  for (let w = 0; w < mode.watches.length; w++) {
    const watch = mode.watches[w];
    const pool = MARKS.slice(0, watch.shapes).map((m) => m.id);
    const watchEnd = watchEndAt(mode, w);

    while (clock < watchEnd - 1.5) {
      let arriveAt = clock;
      // FAIRNESS FLOOR 1: never resolve a vessel inside the window right after
      // the lamp changed. The player is owed time to re-read the rule.
      for (const ct of guardTimes) {
        if (arriveAt >= ct && arriveAt < ct + FEEL.minReadableSeconds) {
          arriveAt = ct + FEEL.minReadableSeconds;
        }
      }
      if (arriveAt >= watchEnd - 0.8) break;

      const lampAt = lampAtTime(lampTimeline, arriveAt);
      const isTrue = rng.chance(0.52);
      let mark = lampAt.mark;
      let hollow = lampAt.hollow;
      if (!isTrue) {
        // Near-miss decoys only exist once the hollow attribute is in play:
        // same shape, different fill. Otherwise a decoy differs by shape.
        if (watch.hollow && rng.chance(0.45)) {
          hollow = !lampAt.hollow;
        } else {
          const others = pool.filter((p) => p !== lampAt.mark);
          mark = rng.pick(others.length ? others : pool);
          hollow = watch.hollow ? rng.chance(0.35) : false;
          if (mark === lampAt.mark && hollow === lampAt.hollow) hollow = !hollow;
        }
      }

      vessels.push({
        arriveAt,
        spawnAt: arriveAt - travel,
        mark,
        hollow,
        hull: rng.pick(HULL_IDS),
        fog: watch.fog,
        watch: w,
      });

      const jitter = rng.range(-0.22, 0.34);
      const lull = rng.chance(FEEL.lullChance)
        ? rng.range(FEEL.lullScaleMin, FEEL.lullScaleMax)
        : 1;
      clock =
        arriveAt +
        Math.max(FEEL.minGapSeconds, (watch.gap * mode.gapScale + jitter) * lull);
    }
  }

  // FAIRNESS FLOOR 2: no two arrivals closer than minGapSeconds, ever.
  vessels.sort((a, b) => a.arriveAt - b.arriveAt);
  for (let i = 1; i < vessels.length; i++) {
    if (vessels[i].arriveAt - vessels[i - 1].arriveAt < FEEL.minGapSeconds) {
      let pushed = vessels[i - 1].arriveAt + FEEL.minGapSeconds;
      // Pushing for floor 2 must not push an arrival back INTO a guard window
      // that floor 1 had already cleared it out of.
      for (const ct of guardTimes) {
        if (pushed >= ct && pushed < ct + FEEL.minReadableSeconds) {
          pushed = ct + FEEL.minReadableSeconds;
        }
      }
      vessels[i].arriveAt = pushed;
      vessels[i].spawnAt = pushed - travel;
    }
  }

  // THE OPENING IS AUTHORED, NOT ROLLED. The first three vessels are fixed:
  // match, match, mismatch. That is the entire tutorial and it contains no
  // words. The first vessel waits at the boom until the player holds, so the
  // verb is discovered rather than instructed; the second confirms the rule
  // was the flag and not "open for everything"; the third is the first vessel
  // that must be refused, and it arrives while the lesson is fresh and the
  // consequence is cheap. Leaving these to the dice would eventually deal a
  // first-ever player a decoy as the ship the game has just told them to let
  // in, which is the one opening this game must never have.
  if (vessels[0]) {
    const l = lampAtTime(lampTimeline, vessels[0].arriveAt);
    vessels[0].mark = l.mark;
    vessels[0].hollow = l.hollow;
  }
  if (vessels[1]) {
    const l = lampAtTime(lampTimeline, vessels[1].arriveAt);
    vessels[1].mark = l.mark;
    vessels[1].hollow = l.hollow;
  }
  if (vessels[2]) {
    const l = lampAtTime(lampTimeline, vessels[2].arriveAt);
    const pool = MARKS.slice(0, mode.watches[0].shapes).map((m) => m.id);
    const others = pool.filter((p) => p !== l.mark);
    vessels[2].mark = others.length ? rng.pick(others) : l.mark;
    vessels[2].hollow = others.length ? l.hollow : !l.hollow;
  }

  const watchBounds = mode.watches.reduce((acc, w) => {
    acc.push((acc[acc.length - 1] ?? 0) + w.seconds);
    return acc;
  }, []);

  return { speed, travel, lampTimeline, vessels, shiftSeconds, watchBounds };
}

/**
 * How long a vessel's flag is readable before it reaches the boom, given the
 * fog on its watch. This is the number the accessibility floor is about, and
 * it is computed the same way the running game computes it.
 */
export function readableSeconds(vessel, speed) {
  const floor = GEO.boomX + FEEL.minReadableSeconds * speed;
  const revealX = Math.max(
    floor,
    GEO.spawnX - (GEO.spawnX - floor) * Math.max(0, Math.min(1, vessel.fog)),
  );
  return (revealX - GEO.boomX) / speed;
}
