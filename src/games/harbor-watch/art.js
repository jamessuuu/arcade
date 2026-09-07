/**
 * HARBOR WATCH — the art pipeline.
 *
 * The style is chosen to hide weakness, which is the honest way to pick a
 * style when nobody on the project can draw: FLAT VECTOR SILHOUETTE, one fixed
 * palette, one warm light source, one outline rule. Nobody rejects a game for
 * being simple; they reject it for being incoherent. Everything here is drawn
 * with Graphics primitives at run time, so there is not one image file in the
 * repository, nothing to licence, nothing to load, and no resolution at which
 * it goes soft.
 *
 * The one rule that outranks aesthetics: THE FLAG IS THE INFORMATION. It is
 * deliberately the brightest, largest, highest-contrast thing on the screen,
 * on a dark plate that keeps it readable over sea, over sky and inside fog.
 * Everything else — hulls, water, stone, weather — is pushed down in contrast
 * to protect it.
 *
 * The cheap moves that do most of the work here, in order of effect per line:
 * reflections in the water, a distant lit shoreline for depth, a rim light in
 * one consistent direction, and a vignette. None is expensive and all four are
 * the difference between "flat shapes" and "a place".
 */

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { VIEW, GEO, SHIP_SCALE, MARKS, HULL_GEO, HULL_IDS } from "./geometry.js";

// The numbers the RULES also depend on live in geometry.js, which imports no
// PixiJS, so plain Node can build a shift and check its fairness floors.
// Re-exported here so every caller still has one door to knock on.
export { VIEW, GEO, SHIP_SCALE, MARKS, HULL_GEO, HULL_IDS };

/** The palette. Every colour in the game is in this object; docs/ART.md quotes
 *  these exact values, and nothing may introduce a colour that is not here. */
export const C = {
  skyTop: 0x060a16,
  skyMid: 0x0f1b33,
  skyBottom: 0x24395e,
  star: 0xdfe8ff,
  moon: 0xfff4d8,
  shore: 0x0b1526,
  shoreLight: 0xffc25c,
  seaFar: 0x1b2c4d,
  seaMid: 0x122038,
  seaNear: 0x0a1120,
  moonPath: 0x37587f,
  glitter: 0xa9cef2,
  wave: 0x2c4a72,
  stone: 0x212a3b,
  stoneLit: 0x33405a,
  stoneEdge: 0x51617f,
  hull: 0x0a1523,
  hullDeck: 0x18263c,
  hullRim: 0x6d8fb8,
  window: 0xffc25c,
  amber: 0xffc25c,
  amberBright: 0xfff3d6,
  amberDeep: 0xff9a3c,
  plate: 0x0a1220,
  bad: 0xe8604f,
  fog: 0xa9bfd8,
  dawnTop: 0x2c3f6e,
  dawnMid: 0xd97a4e,
  dawnBottom: 0xf6c98a,
};

// --------------------------------------------------------------- textures ---

let _glowTex = null;
/** One radial-gradient texture, tinted per use. Cheaper and steadier than a
 *  blur filter, which would cost a render pass per light. */
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.32, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _glowTex = Texture.from(cv);
  return _glowTex;
}

let _vignetteTex = null;
function vignetteTexture() {
  if (_vignetteTex) return _vignetteTex;
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.28,
    size / 2,
    size / 2,
    size * 0.72,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _vignetteTex = Texture.from(cv);
  return _vignetteTex;
}

function verticalGradientTexture(stops, height = 256) {
  const cv = document.createElement("canvas");
  cv.width = 4;
  cv.height = height;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, height);
  for (const [pos, hex] of stops) g.addColorStop(pos, hexToCss(hex));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, height);
  return Texture.from(cv);
}

function hexToCss(hex) {
  return "#" + hex.toString(16).padStart(6, "0");
}

export function makeGlow(color, size, alpha = 0.85) {
  const s = new Sprite(glowTexture());
  s.anchor.set(0.5);
  s.width = s.height = size;
  s.tint = color;
  s.alpha = alpha;
  s.blendMode = "add";
  return s;
}

export function makeVignette() {
  const s = new Sprite(vignetteTexture());
  s.anchor.set(0.5);
  s.position.set(VIEW.w / 2, VIEW.h / 2);
  s.width = VIEW.w * 1.4;
  s.height = VIEW.h * 1.55;
  return s;
}

// -------------------------------------------------------------------- sky ---

export function makeSky() {
  const c = new Container();
  const night = new Sprite(
    verticalGradientTexture([
      [0, C.skyTop],
      [0.6, C.skyMid],
      [1, C.skyBottom],
    ]),
  );
  night.width = VIEW.w;
  night.height = GEO.horizon + 8;
  c.addChild(night);

  const dawn = new Sprite(
    verticalGradientTexture([
      [0, C.dawnTop],
      [0.62, C.dawnMid],
      [1, C.dawnBottom],
    ]),
  );
  dawn.width = VIEW.w;
  dawn.height = GEO.horizon + 8;
  dawn.alpha = 0;
  c.addChild(dawn);

  c.dawnLayer = dawn;
  return c;
}

export function makeStars(rng, count) {
  const g = new Graphics();
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, VIEW.w);
    const y = rng.range(8, GEO.horizon - 56);
    g.circle(x, y, rng.range(0.7, 1.9)).fill({
      color: C.star,
      alpha: rng.range(0.22, 0.8),
    });
  }
  return g;
}

export function makeMoon() {
  const c = new Container();
  c.addChild(makeGlow(C.moon, 300, 0.17));
  const disc = new Graphics();
  disc.circle(0, 0, 26).fill(C.moon);
  disc.circle(11, -7, 22).fill({ color: C.skyMid, alpha: 0.95 });
  c.addChild(disc);
  c.position.set(952, 92);
  return c;
}

/**
 * The far shore. A dozen lines that turn a flat backdrop into a place with
 * somewhere else in it, and the warm window dots are the only other sign of
 * life in the scene besides the player's own harbour.
 */
export function makeFarShore(rng) {
  const c = new Container();
  const g = new Graphics();
  const base = GEO.horizon + 2;
  let x = -40;
  const lights = [];
  while (x < VIEW.w + 60) {
    const w = rng.range(26, 78);
    const h = rng.range(8, 34);
    if (rng.chance(0.28)) {
      g.moveTo(x, base)
        .lineTo(x, base - h)
        .lineTo(x + w / 2, base - h - 12)
        .lineTo(x + w, base - h)
        .lineTo(x + w, base)
        .closePath()
        .fill(C.shore);
    } else {
      g.rect(x, base - h, w, h).fill(C.shore);
    }
    if (rng.chance(0.55)) lights.push([x + rng.range(6, w - 6), base - rng.range(4, h)]);
    x += w + rng.range(-6, 14);
  }
  c.addChild(g);

  const lit = new Graphics();
  for (const [lx, ly] of lights) lit.rect(lx, ly, 2.2, 2.6).fill(C.shoreLight);
  lit.alpha = 0.85;
  c.addChild(lit);
  c.lights = lit;
  return c;
}

// -------------------------------------------------------------------- sea ---

export function makeSea(rng) {
  const c = new Container();

  const far = new Graphics();
  far.rect(0, GEO.horizon, VIEW.w, VIEW.h - GEO.horizon).fill(C.seaFar);
  c.addChild(far);

  // Overlapping translucent bands rather than opaque stripes: three fills with
  // falling alpha read as depth, three opaque ones read as a flag.
  const mid = new Graphics();
  mid.rect(0, GEO.horizon + 52, VIEW.w, VIEW.h).fill({ color: C.seaMid, alpha: 0.55 });
  mid.rect(0, GEO.horizon + 96, VIEW.w, VIEW.h).fill({ color: C.seaMid, alpha: 0.7 });
  c.addChild(mid);

  const near = new Graphics();
  near.rect(0, GEO.waterline + 78, VIEW.w, VIEW.h).fill({ color: C.seaNear, alpha: 0.72 });
  near.rect(0, GEO.waterline + 150, VIEW.w, VIEW.h).fill({ color: C.seaNear, alpha: 0.85 });
  c.addChild(near);

  // The moon path. Not decoration: it is the lit strip the dark hulls are read
  // against, which is why the shipping lane sits inside it.
  const path = new Graphics();
  path
    .moveTo(902, GEO.horizon)
    .lineTo(1002, GEO.horizon)
    .lineTo(1290, VIEW.h)
    .lineTo(600, VIEW.h)
    .closePath()
    .fill({ color: C.moonPath, alpha: 0.2 });
  c.addChild(path);

  const lane = new Graphics();
  lane.rect(0, GEO.waterline - 62, VIEW.w, 124).fill({ color: C.moonPath, alpha: 0.14 });
  c.addChild(lane);

  // Wave lines: short horizontal dashes, denser and longer near the camera,
  // giving the water a surface instead of a colour.
  const waves = new Graphics();
  for (let i = 0; i < 140; i++) {
    const y = GEO.horizon + 16 + Math.pow(rng(), 1.6) * (VIEW.h - GEO.horizon - 22);
    const depth = (y - GEO.horizon) / (VIEW.h - GEO.horizon);
    const w = 10 + depth * 54 * rng.range(0.5, 1.5);
    waves
      .rect(rng.range(-20, VIEW.w), y, w, 1 + depth * 1.6)
      .fill({ color: C.wave, alpha: 0.1 + depth * 0.16 });
  }
  c.addChild(waves);
  return c;
}

export function makeGlitter(rng, count) {
  const c = new Container();
  for (let i = 0; i < count; i++) {
    const g = new Graphics();
    const w = rng.range(9, 36);
    g.rect(-w / 2, -1, w, 2).fill({ color: C.glitter, alpha: 0.55 });
    g.position.set(rng.range(560, 1280), rng.range(GEO.horizon + 24, VIEW.h - 16));
    g.phase = rng.range(0, Math.PI * 2);
    g.speed = rng.range(0.6, 1.7);
    g.baseAlpha = rng.range(0.12, 0.42);
    c.addChild(g);
  }
  return c;
}

// ------------------------------------------------------------------ ships ---

/**
 * Three hulls, drawn in three tones plus a rim light and warm windows.
 *
 * Pure black silhouettes were tried first and rejected on the evidence of the
 * first screenshot: against dark water they read as smudges, not ships. A hull
 * tone slightly above the sea, a lighter deckhouse, one cold rim along the top
 * edge (the moon is up and to the right, and every rim in this scene agrees
 * about that) and a row of warm windows costs four extra fills, and it is the
 * whole difference.
 *
 * Which hull a vessel wears is pure distractor noise. The rule is always and
 * only the flag, which is what makes this discrimination rather than memory.
 */
const HULLS = {
  cutter(g) {
    g.moveTo(-62, 0).lineTo(58, 0).lineTo(46, -27).lineTo(-48, -27).closePath().fill(C.hull);
    g.rect(-26, -48, 46, 23).fill(C.hullDeck);
    g.rect(-48, -29, 106, 2.6).fill({ color: C.hullRim, alpha: 0.75 });
    g.rect(-26, -50, 46, 2.2).fill({ color: C.hullRim, alpha: 0.5 });
    for (let i = 0; i < 3; i++) g.rect(-18 + i * 13, -42, 6, 8).fill(C.window);
    g.rect(-2, -76, 4.5, 38).fill(C.hullDeck);
  },
  steamer(g) {
    g.moveTo(-74, 0).lineTo(70, 0).lineTo(58, -23).lineTo(-64, -23).closePath().fill(C.hull);
    g.rect(-40, -52, 62, 29).fill(C.hullDeck);
    g.rect(-64, -25, 134, 2.6).fill({ color: C.hullRim, alpha: 0.75 });
    g.rect(-40, -54, 62, 2.2).fill({ color: C.hullRim, alpha: 0.5 });
    for (let i = 0; i < 4; i++) g.rect(-33 + i * 15, -45, 7, 9).fill(C.window);
    g.rect(-6, -68, 14, 26).fill(C.hull);
    g.rect(-6, -70, 14, 3).fill(C.amberDeep);
    g.rect(-46, -76, 4.5, 32).fill(C.hullDeck);
  },
  barge(g) {
    g.moveTo(-84, 0).lineTo(80, 0).lineTo(72, -21).lineTo(-78, -21).closePath().fill(C.hull);
    g.rect(26, -46, 42, 25).fill(C.hullDeck);
    g.rect(-78, -23, 158, 2.6).fill({ color: C.hullRim, alpha: 0.75 });
    g.rect(26, -48, 42, 2.2).fill({ color: C.hullRim, alpha: 0.5 });
    for (let i = 0; i < 3; i++) g.rect(32 + i * 13, -40, 6, 8).fill(C.window);
    // Deck cargo, so the barge silhouette is not just a slab.
    g.rect(-62, -37, 24, 16).fill(C.hullDeck);
    g.rect(-34, -32, 20, 11).fill(C.hullDeck);
    g.rect(-16, -76, 4.5, 38).fill(C.hullDeck);
  },
};

/** Draw one mark. `size` is the full width. Hollow marks use a thick stroke so
 *  they survive both the fog and the high-contrast setting. */
export function drawMark(g, id, size, color, hollow, strokeW = 5) {
  const r = size / 2;
  const style = hollow
    ? (path) => path.stroke({ width: strokeW, color, alignment: 0.5 })
    : (path) => path.fill(color);

  switch (id) {
    case "round":
      style(g.circle(0, 0, r * 0.9));
      break;
    case "triangle":
      style(g.moveTo(0, -r).lineTo(r * 0.92, r * 0.76).lineTo(-r * 0.92, r * 0.76).closePath());
      break;
    case "square":
      style(g.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6));
      break;
    case "diamond":
      style(g.moveTo(0, -r).lineTo(r, 0).lineTo(0, r).lineTo(-r, 0).closePath());
      break;
    case "cross":
      if (hollow) {
        g.moveTo(-r * 0.9, -r * 0.9).lineTo(r * 0.9, r * 0.9);
        g.moveTo(r * 0.9, -r * 0.9).lineTo(-r * 0.9, r * 0.9);
        g.stroke({ width: strokeW + 1.5, color });
      } else {
        const t = r * 0.38;
        g.rect(-t, -r, t * 2, r * 2).fill(color);
        g.rect(-r, -t, r * 2, t * 2).fill(color);
      }
      break;
    case "notch":
      style(
        g
          .moveTo(-r, -r * 0.8)
          .lineTo(r, -r * 0.8)
          .lineTo(r * 0.28, 0)
          .lineTo(r, r * 0.8)
          .lineTo(-r, r * 0.8)
          .closePath(),
      );
      break;
    default:
      style(g.circle(0, 0, r * 0.9));
  }
  return g;
}

/**
 * A vessel: reflection, hull, and the flag that carries the whole rule.
 *
 * The flag is a dark plate with a bright emblem and a bright border, hung off
 * a short staff. A plate rather than a bare shape, because the emblem has to
 * stay equally readable over open sky, over the lit moon path and inside fog —
 * and a bare bright shape loses to a bright background at exactly the moment
 * the game gets hard.
 */
export function makeVessel({ hull, mark, hollow, contrastBoost }) {
  const c = new Container();
  const geo = HULL_GEO[hull];

  // Reflection first, so it sits under everything.
  const reflection = new Graphics();
  HULLS[hull](reflection);
  reflection.scale.set(1, -0.52);
  reflection.y = 6;
  reflection.alpha = 0.2;
  reflection.tint = 0x5f83ad;
  c.addChild(reflection);

  const body = new Graphics();
  HULLS[hull](body);
  c.addChild(body);

  const glow = makeGlow(C.amber, 78, 0.28);
  glow.position.set(geo.staff[0] + 6, -32);
  c.addChild(glow);

  const flagHolder = new Container();
  const size = contrastBoost ? 54 : 46;
  const halfW = size * 0.62;
  const halfH = size * 0.52;

  flagHolder.addChild(makeGlow(C.amberBright, size * 3.4, 0.22));

  const plate = new Graphics();
  plate.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, 6).fill({ color: C.plate, alpha: 0.92 });
  plate
    .roundRect(-halfW, -halfH, halfW * 2, halfH * 2, 6)
    .stroke({ width: contrastBoost ? 4 : 2.6, color: C.amberBright, alpha: 0.95 });
  flagHolder.addChild(plate);

  const emblem = new Graphics();
  drawMark(emblem, mark, size * 0.72, C.amberBright, hollow, contrastBoost ? 7 : 5.5);
  flagHolder.addChild(emblem);

  flagHolder.position.set(geo.staff[0] + halfW * 0.5, geo.staff[1] + halfH * 0.9);
  c.addChild(flagHolder);

  c.pennant = flagHolder;
  c.body = body;
  c.reflection = reflection;
  c.cabinLamp = glow;
  c.scale.set(SHIP_SCALE);
  return c;
}

// ------------------------------------------------------------ the harbour ---

export function makeTower(height, width, lit) {
  const g = new Graphics();
  g.moveTo(-width / 2, 0)
    .lineTo(width / 2, 0)
    .lineTo(width / 2 - 7, -height)
    .lineTo(-width / 2 + 7, -height)
    .closePath()
    .fill(lit ? C.stoneLit : C.stone);
  // One rim light down the right edge: the moon is up and to the right, and
  // every lit edge in this scene agrees about that.
  g.moveTo(width / 2, 0)
    .lineTo(width / 2 - 7, -height)
    .stroke({ width: 2.4, color: C.stoneEdge, alpha: 0.8 });
  g.rect(-width / 2 + 3, -height - 11, width - 6, 13).fill(C.stoneEdge);
  g.rect(-width / 2 + 3, -height - 11, width - 6, 3).fill({ color: C.hullRim, alpha: 0.6 });
  for (let i = 1; i <= 4; i++) {
    const y = -(height * i) / 5;
    g.rect(-width / 2 + 4, y, width - 8, 1.6).fill({ color: 0x000000, alpha: 0.3 });
  }
  return g;
}

/** The signal lamp above the gate: the single reference the whole game reads
 *  against. Bright, large, and it never moves. */
export function makeSignalLamp(contrastBoost) {
  const c = new Container();

  const glow = makeGlow(C.amber, 330, 0.3);
  glow.position.set(0, -2);
  c.addChild(glow);

  const housing = new Graphics();
  housing.moveTo(-58, -54).lineTo(58, -54).lineTo(0, -92).closePath().fill(C.stoneLit);
  housing.rect(-48, -54, 96, 102).fill(C.stone);
  housing.rect(-48, -54, 96, 102).stroke({ width: 3, color: C.stoneEdge });
  housing.rect(-52, 44, 104, 10).fill(C.stoneEdge);
  c.addChild(housing);

  const pane = new Graphics();
  pane.rect(-37, -43, 74, 80).fill({ color: 0x081120, alpha: 0.96 });
  pane.rect(-37, -43, 74, 80).stroke({ width: 2, color: C.amberDeep, alpha: 0.55 });
  c.addChild(pane);

  const markLayer = new Graphics();
  markLayer.position.set(0, -3);
  c.addChild(markLayer);

  c.markLayer = markLayer;
  c.glow = glow;
  c.contrastBoost = contrastBoost;
  return c;
}

export function setLampMark(lamp, markId, hollow) {
  lamp.markLayer.clear();
  drawMark(
    lamp.markLayer,
    markId,
    lamp.contrastBoost ? 60 : 54,
    C.amberBright,
    hollow,
    lamp.contrastBoost ? 8 : 6.5,
  );
}

/** The boom. A single bar that lifts. The player's whole verb, drawn once. */
export function makeBoom() {
  const c = new Container();
  const bar = new Graphics();
  const W = 74;
  bar.rect(-W, -10, W * 2, 20).fill(C.stone);
  bar.rect(-W, -10, W * 2, 20).stroke({ width: 2.5, color: C.stoneEdge });
  // Hazard chevrons: the bar reads as a barrier by SHAPE, not by colour.
  for (let i = -W + 4; i < W - 12; i += 24) {
    bar
      .moveTo(i, 9)
      .lineTo(i + 12, -9)
      .lineTo(i + 20, -9)
      .lineTo(i + 8, 9)
      .closePath()
      .fill({ color: C.amber, alpha: 0.92 });
  }
  bar.rect(-W, -12, W * 2, 2.4).fill({ color: C.hullRim, alpha: 0.6 });
  c.addChild(bar);
  c.bar = bar;
  return c;
}

/** The lantern chain — the record of the shift, strung across the harbour.
 *  Three glyphs, three SHAPES: colour only ever reinforces. */
export function drawChainMark(g, kind, x, y) {
  if (kind === "lit") {
    g.rect(x - 9, y - 11, 18, 3.4).fill(C.amberDeep);
    g.moveTo(x - 8, y + 9)
      .lineTo(x + 8, y + 9)
      .lineTo(x + 6, y - 8)
      .lineTo(x - 6, y - 8)
      .closePath()
      .fill(C.amber);
    g.circle(x, y + 1, 3.6).fill(C.amberBright);
  } else if (kind === "hollow") {
    g.rect(x - 9, y - 11, 18, 3.4).fill(C.stoneEdge);
    g.moveTo(x - 8, y + 9)
      .lineTo(x + 8, y + 9)
      .lineTo(x + 6, y - 8)
      .lineTo(x - 6, y - 8)
      .closePath()
      .stroke({ width: 2.2, color: C.stoneEdge });
  } else {
    g.rect(x - 9, y - 11, 18, 3.4).fill(0x4a2a2a);
    g.moveTo(x - 8, y + 9)
      .lineTo(x + 8, y + 9)
      .lineTo(x + 6, y - 8)
      .lineTo(x - 6, y - 8)
      .closePath()
      .fill({ color: 0x1c1420, alpha: 0.95 });
    g.moveTo(x - 9, y - 9).lineTo(x + 9, y + 10);
    g.moveTo(x + 9, y - 9).lineTo(x - 9, y + 10);
    g.stroke({ width: 2.8, color: C.bad });
  }
  return g;
}

/** SVG versions of the same three glyphs for the results sheet. The HTML end
 *  screen and the canvas must speak one visual language, or the end of a run
 *  reads as a different product from the run. */
export const CHAIN_SVG = {
  lit: '<svg viewBox="0 0 22 26" width="22" height="26" aria-hidden="true"><rect x="2" y="2" width="18" height="3" fill="#c2761b"/><path d="M4 24h14l-2-17H6z" fill="#e0a13a"/><circle cx="11" cy="15" r="3.4" fill="#fff3d6"/></svg>',
  hollow:
    '<svg viewBox="0 0 22 26" width="22" height="26" aria-hidden="true"><rect x="2" y="2" width="18" height="3" fill="#7b8699"/><path d="M4 24h14l-2-17H6z" fill="none" stroke="#7b8699" stroke-width="2"/></svg>',
  crossed:
    '<svg viewBox="0 0 22 26" width="22" height="26" aria-hidden="true"><path d="M4 24h14l-2-17H6z" fill="#2a2130"/><path d="M3 5l16 18M19 5L3 23" stroke="#c0392b" stroke-width="2.6" fill="none"/></svg>',
};

/** The quay: stone courses, a lit top edge, and bollards. A flat grey slab
 *  read as unfinished in the first screenshot; courses and bollards cost four
 *  lines and make it somewhere a ship could tie up. */
export function makeQuay() {
  const g = new Graphics();
  const top = GEO.waterline + 8;
  g.rect(0, top, GEO.quayEdge, VIEW.h - top).fill(C.stone);
  g.rect(0, top, GEO.quayEdge, 9).fill(C.stoneLit);
  g.rect(0, top, GEO.quayEdge, 2.6).fill({ color: C.hullRim, alpha: 0.55 });
  g.rect(GEO.quayEdge - 3, top, 3, VIEW.h - top).fill({ color: C.stoneEdge, alpha: 0.5 });
  for (let i = 1; i <= 3; i++) {
    g.rect(0, top + i * 42, GEO.quayEdge, 2).fill({ color: 0x000000, alpha: 0.28 });
  }
  for (let x = 44; x < GEO.quayEdge; x += 92) {
    g.rect(x - 7, top - 15, 14, 16).fill(C.stone);
    g.rect(x - 10, top - 19, 20, 5).fill(C.stoneLit);
  }
  return g;
}

/** Fog: soft horizontal bands over the approach, drifting. It hides the flag
 *  and nothing else that matters, so it shortens the decision window without
 *  ever making the rule ambiguous. */
export function makeFogBand(rng) {
  const g = new Graphics();
  const h = rng.range(70, 150);
  const y = rng.range(GEO.horizon - 30, GEO.waterline + 40);
  g.rect(0, 0, VIEW.w * 1.5, h).fill({ color: C.fog, alpha: 1 });
  g.position.set(rng.range(0, VIEW.w), y - h / 2);
  g.driftSpeed = rng.range(4, 13);
  g.baseAlpha = rng.range(0.06, 0.13);
  g.alpha = 0;
  return g;
}
