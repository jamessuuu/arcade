# Feel log — Harbor Watch

Every constant in `src/games/harbor-watch/feel.js` belongs to James. Agents
implement the mechanism and expose the numbers; a feel claim is only valid
against a running build with a human hand on it.

**This log is the deliverable of a tuning session. The diff is not.** A change
without a row here did not happen.

| Date | Constant | From | To | Why | Who |
|---|---|---|---|---|---|
| 2026-09-07 | *all* | — | initial | First guesses by the agent that wrote the mechanism. **None validated by a person playing the game.** | agent |
| 2026-09-07 | `traumaWrongAdmit` | 0.42 | 0.85 | Measured, not felt. Trauma is squared before it becomes a camera offset, so 0.42 produced a peak displacement of **0.45 pixels** — a shake nobody would ever see. The squaring is right; the inputs were on the wrong scale for it. `tests/mechanics.mjs` now samples peak displacement through a whole run so it cannot regress to invisible. | agent |
| 2026-09-07 | `traumaWrongRefuse` | 0.16 | 0.5 | Same reason. | agent |
| 2026-09-07 | `traumaCorrectAdmit` | 0.05 | 0.22 | Same reason. | agent |
| 2026-09-07 | `gateSmoothing` | 0.35 | *removed* | The eased ramp made `gateRaiseSeconds` a lie: the pass test reads `openness` and the bar's height is drawn from the same number, so any easing either makes the game do something other than what the player sees, or makes the stated raise time wrong. Weight is bought from the slam squash and the sound instead. | agent |
| 2026-09-07 | watch gaps (all modes) | 2.0–3.4 | 2.4–3.9 | The first driven run produced 75 decisions in 180 seconds with no gap over 3s. That is a rhythm game wearing a vigilance game's clothes. | agent |
| 2026-09-07 | `lullChance` etc. | — | 0.22 / 1.9–2.9 | Added with the above. Attention only has somewhere to drift if the game sometimes stops asking for it, and a lapse is only interesting if it happens in the quiet and gets caught by the next burst. Standard now runs ~46 vessels with gaps up to ~8s. | agent |
| 2026-09-07 | `gentle.gapScale` | 1.5 | 1.0 | With the wider base gaps, Gentle fell to 15 vessels in 110 seconds — too empty for the youngest band. Now ~22. | agent |

## What James should turn first, in order

1. **`gateRaiseSeconds` (0.3) and `passThreshold` (0.45).** Together these are
   the whole commitment budget: how early you must decide. Too fast and the verb
   has no weight; too slow and a correct decision still loses the ship, which is
   the one failure players will call unfair.
2. **Traffic density.** ~46 decisions in a 3-minute Standard shift. This is the
   single number most likely to be wrong and it is a taste call, not a
   measurement.
3. **`hitstopWrongAdmit` (0.09).** The cheapest impact in the game. Try 0.12 and
   try 0.05; the recipe says exaggerate, then halve.
4. **The trauma trio**, now that they are visible at all.
5. **`shipSpeed` (196) with `minReadableSeconds` (1.4).** Raising speed without
   raising the readable floor is how a focus game quietly becomes a reflex game.
   `tests/spawn-floor.mjs` will fail if that line is crossed.

## Protocol

Change one number. Play a full shift. Write the row. If the row cannot say what
the change fixed, revert it.
