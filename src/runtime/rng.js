/**
 * Seeded PRNG. mulberry32 — 32-bit state, fast, and good enough for shuffling
 * ships and jittering particles.
 *
 * Every game takes its randomness from here and NEVER from Math.random, for
 * one reason that matters more than statistics: a run has to be replayable.
 * When a playtester says "the fourth ship was unfair", the seed is in the
 * results screen and the exact run can be reproduced. It is also what lets the
 * harness assert on a run instead of on a vibe.
 */

export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Float in [lo, hi). */
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  /** Integer in [lo, hi] inclusive. */
  rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
  /** One element of an array. */
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  /** True with probability p. */
  rng.chance = (p) => rng() < p;
  /** Fisher-Yates, in place, returns the same array. */
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  };
  return rng;
}

/** A seed a human can read back off the results screen and type in again. */
export function freshSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}
