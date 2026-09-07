# The Quiet Arcade

Small games designed around sustained attention, delayed reward and deliberate
thinking. One is finished. Two are placeholders on the shelf, marked as such.

**Nothing here collects anything.** No accounts, no analytics, no cookies, no
third-party origins, no network requests at all once the page has loaded. That
is not a privacy policy, it is a design constraint that the test suite proves
on every run and writes to [`docs/network-capture.json`](docs/network-capture.json).

---

## What is actually built

| | |
|---|---|
| **Portal shell** | Home page led by the finished game, two marked-empty berths, and a parent-verifiable page. Rebuilt 2026-09-07 — see *The shell is the same night as the game*. Done. |
| **Slot 1 — Harbor Watch** | One verb, no words on the canvas, a run ends in about three minutes. Playable start to finish. |
| **Slot 2 — planning game** | A real placeholder card marked *in development*. Not playable, not pretending to be. |
| **Slot 3 — restraint game** | Same. |
| **Playtests with real people** | **Zero.** Nobody outside this machine has played it. Every statement below about feel is an intention, not a finding. |

---

## Harbor Watch

> **Hold the line** — a lamp shows one mark; let in the ships that match it,
> turn away the ones that do not, and keep your nerve until dawn.

One verb: **hold** to raise the boom. Space, Enter, Up arrow, a thumb on the
pad, or any face button on a gamepad. That is the entire input surface.

The rule is shown, never written. A signal lamp above the gate displays a
mark; vessels come up the channel flying marks of their own. Nothing on the
canvas is a word, in any language, at any point in a run — so it plays the same
for a six-year-old who cannot read yet and for someone whose language this was
never translated into.

**Difficulty never comes from speed.** It comes from three things: the lamp
changes while you are busy and your habit is now wrong, fog shortens how long a
mark is readable, and the decoys get closer to the real thing. The generator is
forbidden from ever producing a decision window shorter than 1.4 seconds, and
`tests/spawn-floor.mjs` proves it over 3000 generated shifts.

Three modes, one product: **Gentle** (about 2 minutes, one rule all night, no
harbour is spoiled by a mistake), **Standard** (about 3 minutes, three watches,
the lamp changes twice), **Long watch** (about 5½ minutes, five watches).

### The wordless opening

The first vessel of every shift **waits at the boom** and cannot be failed.
A ring pulses over the gate; the moment the player holds, the ship comes in and
the prompt never appears again. The first three vessels are authored rather than
rolled — match, match, mismatch — so a first-ever player is never dealt a decoy
as the ship the game has just taught them to let in.

---

## The shared house runtime

**This is the part that decides whether twenty games are possible at solo
scale.** The unit cost of game N is dominated by everything that is not the
mechanic. All of it lives in `src/runtime/`, once.

```
src/runtime/
  loop.js      Fixed-timestep simulation, interpolated render, clamped
               accumulator, tab-visibility handling, frame-time instrumentation.
  input.js     ACTIONS, not key events. hold/pause/confirm/back, each available
               from keyboard, pointer, touch and gamepad at the same time, with
               a 120ms press buffer and remappable bindings.
  audio.js     WebAudio synthesis. Three player-facing buses, gesture unlock,
               a limiter, and per-cue variance. Zero audio files in the repo.
  save.js      Versioned localStorage with ordered migrations, corrupt-save
               quarantine, and a mid-write interruption recovery path.
  motion.js    Trauma-based screen shake, hitstop, reduced-motion resolution.
               A game asks how much shake it is allowed and gets a number.
  shell.js     Title, mode select, pause, settings, results, credits, focus
               trapping, the live region, the hold pad. All of it as real HTML.
  harness.js   window.__arcade — drive and inspect a running game.
  rng.js       Seeded mulberry32. No game ever calls Math.random.
```

### Adding game 2

A game module exports two things:

```js
export const manifest = { id, title, teaser, tagline, verbLabel, modes, ... };
export function createGame(ctx) { return new MyGame(ctx); }
```

and the instance implements:

```js
init(modeId)          // build the scene into ctx.stage
update(dt, input)     // dt is ALWAYS 1/60. input.down("hold") is the verb.
render(alpha)         // alpha is 0..1 between the last two simulation states
resize(w, h)          // optional
snapshot()            // optional — what the harness and the tests can see
verbMoved()           // optional — powers the input-latency probe
teardown()
```

`ctx` provides `{ stage, rng, seed, audio, motion, hitstop, input, save,
settings, width(), height(), announce(), setHud(), finish(), padState() }`.

Then: one HTML page, one three-line entry file, one card in `index.html`.
**A game never draws a menu, never touches localStorage, never reads a keyboard
event, never asks about reduced motion, and never renders a word.**

The "last 10 percent" that the programme costs at 36% of a game's budget —
title, pause that actually pauses, settings, save round trip, corrupt-save
recovery, results, credits, accessibility — is already built and is inherited.

One rule for a new game: keep the pure constants (geometry, marks, mode tables)
in modules that do **not** import PixiJS, the way
`src/games/harbor-watch/{geometry,feel,schedule,manifest}.js` do. The portal
home and the parents page read game metadata without downloading a renderer,
and the fairness checks run in plain Node.

---

## The shell is the same night as the game

The portal was first built as a cream engineering-paper document: flat cards
with hairline borders, a serif reading face, three paragraphs per card, and two
large grey plates where the unbuilt games were. It was a faithful
implementation of the design doctrine in force at the time. It was also wrong,
in a way that is worth naming precisely rather than calling a taste
disagreement.

**The wrapper contradicted the product.** Harbor Watch is a lit night harbour —
a signal lamp, a moon, light cones on black water. A visitor met a document
first, read three paragraphs about attention, and formed a judgement about the
whole thing before ever seeing what it actually was. The two grey plates made
it worse: they were the largest objects on the page, and what they communicated
was *unfinished*.

What changed, and why each one:

| Was | Is | Because |
|---|---|---|
| Cream ground, follows the OS into light mode | One lighting, dusk, taken from the game's own sky (`art.js`: `0x060a16`, `0x0f1b33`, amber `0xffc25c`) | There is no daylight version of this product. A theme switch on a night harbour is a control with nowhere to go. |
| Three paragraphs per card | One line each, detail behind a disclosure | A portal's job is to get you into the game, not to describe it. |
| A static thumbnail of the game | The harbour itself, animated — the lamp breathing, the beam landing on the water, a ship inside the light, glints drifting | Leading with the thing running is the only honest version of "the game is the best part". |
| Two grey plates the size of the finished game | Two recessed berths at a third the weight, still saying plainly that they are not playable and are not links | Space kept open should look like space kept open. |
| `.panel { border-left: 4px solid var(--accent) }` | A tinted ground and one lit dot in the eyebrow | A thick coloured bar down one edge of a card is the most recognisable tell of generated UI. |
| Five house rules as five paragraphs | A five-cell specification strip | Every cut clause is written out in full on the parents page, which is where a claim belongs. |
| A **Theme** control offering Follow-my-device / Light / Dark | Removed | It was already half-dead — `[data-theme="light"]` existed only as a negation inside the `prefers-color-scheme` block, so on a light-scheme machine the Light button did nothing. On a site whose entire pitch is that its claims can be checked, a switch that reports a state it does not have is a claim that fails the check. |

Structure follows section 12 of the shared design spine: a 10px structure
radius, a three-step elevation ladder, one easing curve and two durations, and
one ambient wash tinted by the project's own signal hue.

Three effects are **banned in this file by name**, with the numbers that
banned them — measured on another project the same week, not guessed:

| Effect | Cost |
|---|---|
| Gaussian blur on a shadow layer | 58 → 24 fps |
| `mix-blend-mode: overlay` | 60 → 47.8 fps |
| `backdrop-filter` on small chips | 60 → 44.7 fps |

So every glow here is a paint-once radial gradient and every animation moves
only `transform` and `opacity`. `node tests/portal-cost.mjs` measures the
result against the same page with motion off: **0 ms** difference in p50 frame
time, 59.9 fps either way, no dropped frames. The game's own budget is
unchanged at **p50 5.0 ms / p95 5.1 ms** — the `backdrop-filter` that used to
sit on the pause overlay is gone, which if anything gives it back a little.

---

## Measured numbers

Everything below was measured on this machine on 2026-09-07. Nothing is
estimated. Re-run any of it yourself with the commands shown.

### Payload — `npm run verify:budget`

| Page | Transferred | gzip equivalent | Requests |
|---|---|---|---|
| Portal home | 41.2 kB | 10.6 kB | 2 |
| For parents | 41.9 kB | 13.3 kB | 4 |
| Harbor Watch | **510.8 kB** | **152.5 kB** | 12 |

Whole built site: 608.9 kB across 17 files (182.6 kB gzipped). The programme's
first-load budget is 2 MB; the game page uses 25% of it. PixiJS is the bulk of
it and is code-split, so the two content pages never download the renderer.

The portal home grew by 14 kB uncompressed (2.9 kB gzipped) when the shell was
rebuilt — that is the animated harbour scene, which is inline SVG. It is still
two requests, because inline SVG is not a request, and there is still no image
file, no font file and no third-party anything in this repository.

### Frame time — `npm run verify:gpu`

Measured over a **complete real-time run** (194 seconds, 37,716 frames) at
1280×800 on an **AMD Radeon RX 9060 XT** (ANGLE / Direct3D11):

| | |
|---|---|
| Median frame | **5.0 ms** |
| p95 frame | **5.1 ms** |
| Worst frame in any 10-second window | **10.0 ms** |
| Frames over 16.7 ms, whole run | **1 of 37,716** |
| Frames over 33 ms, whole run | **1 of 37,716** |
| Worst single frame | **135 ms** |

That one long frame is the first frame of the run, where the scene graph is
built and the shaders are compiled. It is reported rather than excluded. Pack
row G2 asks for zero frames over 33 ms, so on a strict reading this run misses
it by one startup frame; every other frame in three minutes of play cleared
16.7 ms.

**How to get a number that means anything**, learned the hard way:

- Playwright's default headless build rasterises through SwiftShader, a CPU
  renderer. It reports ~50 ms frames here. Those are never quoted.
- A headed window on the real GPU gets throttled to **1 Hz** whenever Chromium
  decides the window is occluded — which, for an automated window sitting
  behind an editor, is most of the time. Two separate headed runs produced
  1005 ms "frames" for that reason and nothing else. Several flags and a
  default-args override failed to prevent it.
- `--gpu` uses the full Chromium binary in headless=new on the hardware
  renderer. No window exists, so nothing can be called occluded. That is where
  the table above comes from, and the test now **fails rather than reports** if
  its worst frame exceeds 400 ms, so an occlusion-throttled measurement can
  never be published as a real one.

### Input latency

| | |
|---|---|
| Median press → first changed rendered frame | **10.4 ms** |
| p95 | **14.7 ms** |
| Worst | **17.8 ms** |

**This is an in-page proxy, not a press-to-photon measurement.** It is the time
from the keydown event to the first rendered frame on which the gate had
actually moved, and it excludes everything downstream of the browser's paint:
compositing, display latency, the panel itself. A true measurement needs a
high-speed camera and has not been done. The programme's bar is "under about
50 ms reads as instant"; the part measured here uses a fifth of that.

### Network — `npm run verify:network`

18 requests total across all three pages. Every one is to the page's own
origin. **Zero requests after the page finished loading**, including through a
complete played run with menus opened and settings changed. Full log in
[`docs/network-capture.json`](docs/network-capture.json).

---

## Verifying it yourself

```bash
npm install
npm run build
npm run verify              # everything
npm run verify:gpu          # a real-time run on the real GPU
```

| Command | What it proves |
|---|---|
| `verify:play` / `verify:gpu` | A script opens the game, presses Play, reads only what the screen has revealed, and holds a real Space key for a full shift. Asserts the world changed: vessels resolved, ships berthed, the lantern chain grew, the run reached an ending on its own. Screenshots to `docs/screenshots/`, checked for pixel variance rather than for existing. |
| `tests/menus.mjs` | Every button in every sheet, clicked with a real mouse; the hold pad with a real finger; the whole shell with the keyboard alone. |
| `tests/mechanics.mjs` | Plays *badly* on purpose and asserts the game notices. Fixed-timestep determinism at two frame rates. Pause really pauses. Motion settings honoured at runtime. All four save-recovery paths. |
| `verify:patterns` | The enumerated dark-pattern list, checked at runtime: notification permission never requested, no service worker, no cookie ever written, nothing streak-shaped in storage, no link out of a game, no autoplay. |
| `verify:network` | The receipt above. |
| `verify:claims` | A denylist over every shipped string. |
| `verify:a11y` | Target sizes, contrast against *rendered* colours under both `prefers-color-scheme` values and under the high-contrast setting, one h1, skip links, accessible names, keyboard traversal. |
| `tests/portal-cost.mjs` | What the portal's motion costs, measured against the same page with motion switched off. The animated hero moves `transform` and `opacity` only; the measured difference in p50 frame time is 0 ms. |
| `tests/spawn-floor.mjs` | 3000 generated shifts; no decision window under the floor, ever. |
| `verify:budget` | The payload table above. |
| `verify:bytes` | Sweeps every text file for stray control bytes. This exists because a regex written through a shell heredoc had its `\b` collapsed into a literal BACKSPACE byte, so the pattern matched nothing while its check reported a clean pass. A dead checker's silence is indistinguishable from a real pass, which is why several of these gates plant a violation in themselves first. |

Four of these checkers **plant a violation in themselves first and fail if they
cannot find it**, because a checker that has never caught anything is
indistinguishable from a checker whose pattern is broken. That is not a
hypothetical: it happened here, and `verify:bytes` is the guard that came out
of it.

---

## What this project claims, and what it refuses to claim

<!-- claims-negation:start — this section names the forbidden claims in order
     to refuse them, which is the one place they may appear. tests/claims-check.mjs
     strips regions between these markers and prints what it stripped. -->
These games are **designed around** sustained attention, delayed reward and
deliberate thinking. That is a description of how they are built and you can
check it by playing one.

They are **not** claimed to improve focus, increase attention span, train the
brain, help with ADHD or any other condition, make anyone smarter, improve
school or work performance, or produce any benefit that survives closing the
tab. There is no evidence for any of that here, so no such claim is made
anywhere — in the product, in this README, or in anything written about it.

The precedent is specific and was verified rather than recalled: **FTC v. Lumos
Labs, announced 2016-01-05**, which required competent and reliable scientific
evidence before any future claim about real-world performance or health
conditions including ADHD. `npm run verify:claims` fails the build if a
forbidden phrase appears outside a marked disclaimer like this one.
<!-- claims-negation:end -->

---

## Authorship

Gameplay code, runtime and tests written by software agents under direction.
The feel constants in `src/games/harbor-watch/feel.js` and every playtest
verdict belong to **James Lorenz Santos** — and at the time of writing he has
tuned none of them and run no playtests, so every one is an agent's first guess.
`docs/FEEL-LOG.md` is where that changes.

## Stack and licences

| | |
|---|---|
| [PixiJS](https://github.com/pixijs/pixijs) 8.20.1 | MIT — the renderer, and the only runtime dependency |
| [Vite](https://vitejs.dev) 6.4.3 | MIT — build only, not shipped |
| Playwright | Apache-2.0 — borrowed from a sibling project; not a dependency of this one |

**Zero art, audio or font assets.** Every visual is drawn from Graphics
primitives at run time and every sound is synthesised from oscillators and
filtered noise, so the licence ledger for assets is empty — and an empty ledger
is the only one that cannot be wrong. Type is a system font stack; no font is
ever fetched from anywhere.

Code in this repository is MIT licensed. See [LICENSE](LICENSE).

---

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/agentjames-mark-inv.svg">
    <img src="docs/brand/agentjames-mark.svg" alt="Agent James" width="24" height="24">
  </picture>
  Built by <a href="https://agentjames.vercel.app">James Lorenz Santos</a> · <a href="https://www.linkedin.com/in/james-lorenz-santos-720776251/">LinkedIn</a>
</p>
