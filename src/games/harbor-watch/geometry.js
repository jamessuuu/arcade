/**
 * HARBOR WATCH — the numbers the art and the rules must agree on.
 *
 * Extracted from art.js for one reason: art.js imports PixiJS, and the
 * fairness checks in tests/spawn-floor.mjs need to build a thousand shifts in
 * plain Node without a browser. A test that has to re-declare the geometry it
 * is checking is a test that will silently drift away from the game.
 */

export const VIEW = { w: 1280, h: 720 };

export const GEO = {
  horizon: 300,
  waterline: 468, // the y at which hulls sit
  boomX: 430,
  towerNearX: 492,
  towerFarX: 368,
  /** How far the bar lifts. Sized against `FEEL.passThreshold`: at the
   *  threshold the bar must be clear of the tallest part of a vessel, flag
   *  included, or the game would pass a ship through something it visibly hit. */
  boomTravel: 235,
  spawnX: 1460,
  despawnX: -300,
  quayEdge: 340,
  chainX: 40,
  chainY: 206,
  chainStep: 27,
  chainPerRow: 11,
  chainRowStep: 33,
};

/** Vessels are drawn at their natural size and then scaled once. The first
 *  pass drew them at 1.0 and they read as slabs with a sign on them. */
export const SHIP_SCALE = 1.22;

/** Flag marks. Shape is the whole information channel; fill is a second
 *  attribute used only in the hardest watches. Names are read aloud by the
 *  screen-reader announcements, so they are words a child would use. */
export const MARKS = [
  { id: "round", name: "round" },
  { id: "triangle", name: "triangle" },
  { id: "square", name: "square" },
  { id: "diamond", name: "diamond" },
  { id: "cross", name: "cross" },
  { id: "notch", name: "swallowtail" },
];

/**
 * Per-hull geometry the RULES depend on.
 *
 * `bow` is how far the leading edge reaches ahead of the vessel's origin.
 * Vessels sail right to left, so the leading edge is at `x - bow`, and that is
 * the point that meets the boom. The first version of this table used the
 * trailing (+x) extent by mistake, which resolved every vessel a full hull
 * length AFTER it had visibly crossed the barrier.
 */
export const HULL_GEO = {
  cutter: { staff: [0, -76], bow: 62 * SHIP_SCALE },
  steamer: { staff: [-44, -76], bow: 74 * SHIP_SCALE },
  barge: { staff: [-14, -76], bow: 84 * SHIP_SCALE },
};

export const HULL_IDS = Object.keys(HULL_GEO);
