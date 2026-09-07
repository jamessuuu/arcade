# The art bar

**Status: NOT APPROVED.** The programme gives James the art bar — he approves
this document, the exact palette, the outline rule and the forbidden list
before assets are made, and he can reject any screenshot against it. Nothing
here has been through that gate. It is the direction the first game was built
to, written down so it can be rejected precisely rather than vaguely.

---

## The style, and why this one

**Flat vector silhouette. One fixed palette. One warm light source. One outline
rule. Everything drawn from Graphics primitives at run time.**

Chosen to hide weakness, which is the honest way to pick a style when nobody on
the project can draw. Nobody rejects a game for being simple; they reject it
for being incoherent. The reference is Mini Metro: a fixed flat-vector palette
as the entire art budget, and it still reads premium.

Consequences, all deliberate:

- **No image files anywhere.** Nothing to licence, nothing to load, no
  resolution at which it goes soft, and a `docs/` asset ledger that is empty.
- **No sprite atlas, no texture budget, no art pipeline.** Games 2 through 20
  inherit the palette and the primitives.
- **The cost is texture and character.** This style cannot do a painted
  background or an expressive face. If a later game needs one, that game needs
  a different style and a real art budget, and that is a decision, not a drift.

---

## The rule that outranks aesthetics

> **The information channel is the brightest, largest, highest-contrast thing
> on the screen, and everything else is pushed down to protect it.**

In Harbor Watch that is the flag: a dark plate with a bright emblem and a
bright border, on a short staff. A plate rather than a bare shape, because the
emblem must stay equally readable over open sky, over the lit moon path and
inside fog — a bare bright shape loses to a bright background at exactly the
moment the game gets hard.

Everything else in the frame — hulls, water, stone, weather — is tuned down so
this stays true.

---

## The palette

Every colour in the game is in `src/games/harbor-watch/art.js` as `C`, and
nothing may introduce one that is not there.

| Token | Hex | Used for |
|---|---|---|
| `skyTop` | `#060a16` | zenith |
| `skyMid` | `#0f1b33` | mid sky |
| `skyBottom` | `#24395e` | horizon glow |
| `star` | `#dfe8ff` | stars |
| `moon` | `#fff4d8` | the moon disc and its halo |
| `shore` | `#0b1526` | far shoreline silhouette |
| `shoreLight` | `#ffc25c` | windows on the far shore |
| `seaFar` | `#1b2c4d` | water at the horizon |
| `seaMid` | `#122038` | mid water |
| `seaNear` | `#0a1120` | foreground water |
| `moonPath` | `#37587f` | the lit strip hulls are read against |
| `glitter` | `#a9cef2` | moving highlights on the water |
| `wave` | `#2c4a72` | wave dashes |
| `stone` | `#212a3b` | towers, quay, the boom bar |
| `stoneLit` | `#33405a` | lit stone faces |
| `stoneEdge` | `#51617f` | stone rims and caps |
| `hull` | `#0a1523` | vessel hulls |
| `hullDeck` | `#18263c` | deckhouses and cargo |
| `hullRim` | `#6d8fb8` | the cold rim light |
| `window` / `amber` | `#ffc25c` | warm light, the lantern chain |
| `amberBright` | `#fff3d6` | the flag emblem and the lamp mark |
| `amberDeep` | `#ff9a3c` | lantern hoods, funnel bands |
| `plate` | `#0a1220` | the flag's backing plate |
| `bad` | `#e8604f` | the crossed lantern, and nothing else |
| `fog` | `#a9bfd8` | fog bands |
| `dawnTop/Mid/Bottom` | `#2c3f6e` / `#d97a4e` / `#f6c98a` | the ending sky |

The portal chrome is a separate, deliberately calmer system in
`styles/tokens.css`: OKLCH, warm paper, hairline borders, a serif reading face.
The games may be far more colourful than the chrome. The chrome may not.

---

## The outline rule

**One light source: the moon, up and to the right.** Every lit edge in the
scene agrees about it.

- Vessels: a cold `hullRim` line along the top edge of the hull and along the
  top of the deckhouse. Never a full outline.
- Towers: a rim stroke down the **right** edge only, plus a lit cap.
- Quay: a lit top surface and a lit vertical on its seaward edge.
- Stone: horizontal course lines are black at low alpha, never a lighter colour.

---

## Colour is never the only channel

Required by the accessibility floor and checked by `tests/a11y-check.mjs`.

| Meaning | Shape | Colour (reinforcement only) |
|---|---|---|
| Ship berthed correctly | filled lantern with a lit core | amber |
| True ship turned away by mistake | **outline-only** lantern | grey |
| Decoy let in by mistake | lantern with a **cross** through it | red |

The same three glyphs are drawn on the canvas and as SVG on the results sheet,
so the end of a run does not read as a different product from the run.

Card status on the portal uses a word **and** a border style (solid vs dashed)
**and** a glyph, never hue alone.

---

## The forbidden list

- **No gradients other than the two sky gradients and the glow sprite.** Flat
  fills everywhere else. A stray gradient is the fastest way to make this style
  look accidental.
- **No drop shadows.** Depth comes from value and overlap.
- **No colour outside `C`.**
- **No text on the canvas, ever.** Not a score, not a label, not a tutorial.
  If something needs a word, it belongs in the HTML chrome or it does not exist.
- **No full outlines on shapes.** Rim lights only, in one direction.
- **No colour-only signalling.**
- **No screen-wide flash the player cannot switch off**, and none at all under
  reduced motion.
- **No photosensitivity risk.** No effect repeats faster than about 3 Hz. The
  authoritative threshold is a number this project has not verified, and
  trust-safety owes it before any flashing effect ships; until then the rule is
  simply "do not build one".
- **No non-integer sprite scaling** — moot here, since nothing is a sprite.
- **No AI-generated assets.** There are no assets.

---

## Open questions for James

1. Is the night-harbour register right for a portal that is also meant to hold
   a cheerful planning game and a restraint game? A shared palette across
   twenty games is a strong constraint and this one is dark.
2. The vessels currently read at `SHIP_SCALE = 1.22`. The first pass at 1.0
   read as slabs. Is 1.22 far enough?
3. The raised boom reads as a bar hanging beside the near tower rather than
   spanning the channel. A rail or a counterweight would fix it and costs about
   ten lines.
4. Does the lantern chain read as *your harbour*, or as a HUD?
