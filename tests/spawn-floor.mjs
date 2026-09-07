/**
 * FAIRNESS FLOORS, proved across a thousand shifts per mode.
 *
 * The accessibility contract this project holds itself to says no mechanic may
 * require an input faster than about 200ms to be playable at all. A vigilance
 * game is one bad constant away from breaking that, and the break would be
 * invisible: it would only show up on the seeds nobody happened to play.
 *
 * So this runs the real generator — the same module the game runs — over 3000
 * shifts and asserts the floors on every vessel in every one of them. No
 * browser, no rendering, about a second.
 */

import { makeRng } from "../src/runtime/rng.js";
import { FEEL, MODES } from "../src/games/harbor-watch/feel.js";
import { buildSchedule, readableSeconds, lampAtTime } from "../src/games/harbor-watch/schedule.js";
import { ok, info, isMain } from "./lib.mjs";

const SEEDS = 1000;

export async function run() {
  for (const mode of Object.values(MODES)) {
    let minGap = Infinity;
    let minReadable = Infinity;
    let minAfterLampChange = Infinity;
    let worstSeed = null;
    let totalVessels = 0;
    let trueVessels = 0;
    let shiftMin = Infinity;
    let shiftMax = 0;
    let openingWrong = 0;
    let emptyShifts = 0;

    for (let i = 0; i < SEEDS; i++) {
      const seed = 1000003 + i * 7919;
      const built = buildSchedule(makeRng(seed), mode);
      const v = built.vessels;
      if (v.length < 8) emptyShifts++;
      totalVessels += v.length;

      shiftMin = Math.min(shiftMin, built.shiftSeconds);
      shiftMax = Math.max(shiftMax, built.shiftSeconds);

      for (let j = 0; j < v.length; j++) {
        if (j > 0) {
          const gap = v[j].arriveAt - v[j - 1].arriveAt;
          if (gap < minGap) {
            minGap = gap;
            worstSeed = seed;
          }
        }
        const r = readableSeconds(v[j], built.speed);
        if (r < minReadable) minReadable = r;

        const lamp = lampAtTime(built.lampTimeline, v[j].arriveAt);
        if (v[j].mark === lamp.mark && v[j].hollow === lamp.hollow) trueVessels++;

        // Time between the lamp changing and this vessel having to be judged.
        // Every timeline entry after t=0 is a real change: a watch boundary
        // changes the lamp too, and that is the case the generator originally
        // failed to guard.
        for (const e of built.lampTimeline) {
          if (e.t <= 0) continue;
          const d = v[j].arriveAt - e.t;
          if (d >= 0 && d < minAfterLampChange) minAfterLampChange = d;
        }
      }

      // The authored opening: match, match, mismatch.
      const l0 = lampAtTime(built.lampTimeline, v[0]?.arriveAt ?? 0);
      const l1 = lampAtTime(built.lampTimeline, v[1]?.arriveAt ?? 0);
      const l2 = lampAtTime(built.lampTimeline, v[2]?.arriveAt ?? 0);
      const m = (a, b) => a && a.mark === b.mark && a.hollow === b.hollow;
      if (!m(v[0], l0) || !m(v[1], l1) || m(v[2], l2)) openingWrong++;
    }

    console.log(`\n--- ${mode.name} (${SEEDS} shifts) ---`);
    info("vessels per shift (mean)", (totalVessels / SEEDS).toFixed(1));
    info("share of vessels that should be let in", ((trueVessels / totalVessels) * 100).toFixed(1) + "%");
    info("shift length (s)", `${shiftMin.toFixed(0)} to ${shiftMax.toFixed(0)}`);

    ok(
      `${mode.name}: no two vessels ever arrive closer than ${FEEL.minGapSeconds}s`,
      minGap >= FEEL.minGapSeconds - 1e-6,
      `tightest gap ${minGap.toFixed(3)}s (seed ${worstSeed})`,
    );
    ok(
      `${mode.name}: every flag is readable for at least ${FEEL.minReadableSeconds}s before the boom`,
      minReadable >= FEEL.minReadableSeconds - 1e-6,
      `shortest window ${minReadable.toFixed(3)}s`,
    );
    ok(
      `${mode.name}: no vessel is judged within ${FEEL.minReadableSeconds}s of a lamp change`,
      minAfterLampChange >= FEEL.minReadableSeconds - 1e-6 ||
        minAfterLampChange === Infinity,
      minAfterLampChange === Infinity
        ? "this mode never changes the lamp"
        : `closest ${minAfterLampChange.toFixed(3)}s`,
    );
    ok(
      `${mode.name}: the wordless opening is always match, match, mismatch`,
      openingWrong === 0,
      openingWrong + " shifts had the wrong opening",
    );
    ok(`${mode.name}: no shift is generated empty`, emptyShifts === 0, emptyShifts + " thin shifts");
    ok(
      `${mode.name}: the mix is neither all-open nor all-shut`,
      trueVessels / totalVessels > 0.35 && trueVessels / totalVessels < 0.65,
    );

    // The decision window is what the accessibility floor is really about: the
    // shortest time a player could have between seeing a flag and needing the
    // gate in the right position, allowing for the gate's own travel time.
    const worstDecision = minReadable - FEEL.gateRaiseSeconds;
    ok(
      `${mode.name}: worst-case decision time stays well above the 200ms floor`,
      worstDecision > 0.5,
      `${(worstDecision * 1000).toFixed(0)}ms after subtracting the ${FEEL.gateRaiseSeconds * 1000}ms gate raise`,
    );
  }
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\nspawn-floor: FAILURES ABOVE" : "\nspawn-floor: all floors hold"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
