/**
 * HARBOR WATCH
 *
 * One verb: HOLD to raise the boom. That is the entire input surface.
 *
 * The rule is shown, never written. A lamp above the gate displays a mark.
 * Vessels come up the channel flying marks of their own. Let the matching ones
 * in; turn the rest away. Nothing on the canvas is a word, in any language, at
 * any point in a run — which is also why the game works identically for a
 * six-year-old who cannot read yet and for someone playing in a language this
 * project was never translated into.
 *
 * The difficulty never comes from speed. It comes from three things that make
 * a three-minute watch genuinely hard to hold: the lamp changes while you are
 * busy and your habit is now wrong; fog shortens how long a mark is readable;
 * and the decoys get closer to the real thing. The spawner is forbidden from
 * ever producing a decision window under `FEEL.minReadableSeconds`, and
 * tests/spawn-floor.mjs proves it across a thousand seeds — because "we made
 * it harder by making it faster" is exactly how a focus game turns into a
 * reflex game, which is the thing this whole portal exists not to be.
 */

import { Container, Graphics } from "pixi.js";
import { FEEL, MODES } from "./feel.js";
import { buildSchedule } from "./schedule.js";
import {
  VIEW,
  GEO,
  C,
  MARKS,
  HULL_IDS,
  HULL_GEO,
  CHAIN_SVG,
  makeSky,
  makeStars,
  makeMoon,
  makeFarShore,
  makeSea,
  makeGlitter,
  makeVessel,
  makeTower,
  makeQuay,
  makeSignalLamp,
  setLampMark,
  makeBoom,
  makeGlow,
  makeVignette,
  drawChainMark,
  makeFogBand,
  drawMark,
} from "./art.js";

/** Bow offset per hull, taken from the art so the two can never disagree.
 *  Vessels sail RIGHT TO LEFT, so the leading edge is at `x - BOW`, and that
 *  is the point the boom tests against. */
const BOW = Object.fromEntries(
  Object.entries(HULL_GEO).map(([k, v]) => [k, v.bow]),
);

export { manifest } from "./manifest.js";

export function createGame(ctx) {
  return new HarborWatch(ctx);
}

class HarborWatch {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new Container();
    ctx.stage.addChild(this.root);
  }

  // ------------------------------------------------------------------ init --

  init(modeId) {
    const ctx = this.ctx;
    this.mode = MODES[modeId] ?? MODES.standard;
    this.contrastBoost = ctx.settings.contrast === "high";

    this.time = 0; // shift clock, seconds; frozen during the wordless teach
    this.finished = false;
    this.phase = "watch"; // watch | dawn | done
    this.dawnT = 0;
    this.watchIndex = 0;

    this.gate = { openness: 0, target: 0, velocity: 0, slam: 0 };
    this._opennessAtPress = 0;
    this._prevHold = false;

    this.lampMark = null;
    this.lampHollow = false;
    this.lampPop = 0;

    this.vessels = [];
    this.chain = []; // "lit" | "hollow" | "crossed"
    this.chainPop = -1;
    this.chainPopT = 0;

    this.stats = { berthed: 0, missed: 0, fouled: 0, turned: 0, total: 0 };
    this.flash = 0;
    this.fogTarget = 0;
    this.fogNow = 0;

    this.teaching = true; // the wordless first-ship teach
    this.promptT = 0;

    this._buildScene();
    this._buildSchedule();

    // The lamp starts on the first watch's mark, lit before anything moves, so
    // the reference exists before the first decision does.
    this._setLamp(this.lampTimeline[0].mark, this.lampTimeline[0].hollow, false);
    this._updateHud();
    ctx.announce(
      `The watch begins. The lamp shows a ${markName(this.lampMark)}. Hold to raise the boom.`,
    );
  }

  _buildScene() {
    const ctx = this.ctx;
    const rng = ctx.rng;
    this.root.removeChildren();

    this.world = new Container();
    this.root.addChild(this.world);

    this.sky = makeSky();
    this.world.addChild(this.sky);
    this.stars = makeStars(rng, FEEL.starCount);
    this.world.addChild(this.stars);
    this.moon = makeMoon();
    this.world.addChild(this.moon);
    this.farShore = makeFarShore(rng);
    this.world.addChild(this.farShore);

    this.sea = makeSea(rng);
    this.world.addChild(this.sea);
    this.glitter = makeGlitter(rng, FEEL.moonGlitterCount);
    this.world.addChild(this.glitter);

    // Vessels sit between the water and the harbour structures so a turned
    // vessel passes behind the near tower — cheap depth, no extra art.
    this.vesselLayer = new Container();
    this.world.addChild(this.vesselLayer);

    // The far tower, then the boom, then the near tower: the bar reads as
    // running between them.
    const towerFar = makeTower(250, 58, false);
    towerFar.position.set(GEO.towerFarX, GEO.waterline + 14);
    this.world.addChild(towerFar);

    this.boom = makeBoom();
    this.boom.position.set(GEO.boomX, GEO.waterline);
    this.world.addChild(this.boom);

    const towerNear = makeTower(268, 66, true);
    towerNear.position.set(GEO.towerNearX, GEO.waterline + 26);
    this.world.addChild(towerNear);

    this.lamp = makeSignalLamp(this.contrastBoost);
    this.lamp.position.set(GEO.towerNearX, GEO.waterline - 268);
    this.world.addChild(this.lamp);

    // The quay on the left, and the chain of lanterns strung above it.
    this.world.addChild(makeQuay());

    const rope = new Graphics();
    rope
      .moveTo(GEO.chainX - 18, GEO.chainY - 24)
      .quadraticCurveTo(180, GEO.chainY + 6, GEO.towerFarX - 14, GEO.chainY - 44)
      .stroke({ width: 2, color: C.stoneEdge, alpha: 0.55 });
    this.world.addChild(rope);

    this.chainLayer = new Graphics();
    this.world.addChild(this.chainLayer);

    // Fog rides above everything except the prompt.
    this.fogLayer = new Container();
    for (let i = 0; i < FEEL.fogBandCount; i++)
      this.fogLayer.addChild(makeFogBand(rng));
    this.world.addChild(this.fogLayer);

    this.world.addChild(makeVignette());

    // The wordless prompt: a pulsing ring and a rising chevron over the boom.
    this.prompt = new Container();
    const ring = new Graphics();
    ring.circle(0, 0, 46).stroke({ width: 4, color: C.amberBright });
    this.prompt.addChild(ring);
    const chev = new Graphics();
    chev
      .moveTo(-16, 12)
      .lineTo(0, -6)
      .lineTo(16, 12)
      .stroke({ width: 6, color: C.amberBright, cap: "round", join: "round" });
    chev.position.set(0, -4);
    this.prompt.addChild(chev);
    this.prompt.addChildAt(makeGlow(C.amberBright, 190, 0.35), 0);
    this.prompt.position.set(GEO.boomX, GEO.waterline - 92);
    this.prompt.alpha = 0;
    this.promptRing = ring;
    this.world.addChild(this.prompt);

    // A full-screen warm pop for correct admits and a cold one for errors.
    this.flashLayer = new Graphics();
    this.flashLayer.rect(-400, -400, VIEW.w + 800, VIEW.h + 800).fill(0xffffff);
    this.flashLayer.alpha = 0;
    this.world.addChild(this.flashLayer);

    this._redrawChain();
  }

  // -------------------------------------------------------------- schedule --

  /** The generator itself lives in schedule.js, with no PixiJS in its import
   *  graph, so tests/spawn-floor.mjs can build a thousand shifts in plain Node
   *  and prove the fairness floors hold on every one of them. */
  _buildSchedule() {
    const built = buildSchedule(this.ctx.rng, this.mode);
    this.speed = built.speed;
    this.travel = built.travel;
    this.lampTimeline = built.lampTimeline;
    this.schedule = built.vessels;
    this.shiftSeconds = built.shiftSeconds;
    this.watchBounds = built.watchBounds;
    this.nextSpawn = 0;
    this.nextLamp = 1;
  }

  // ------------------------------------------------------------------ loop --

  update(dt, input) {
    if (this.finished) return;

    const held = input.down("hold");
    if (held && !this._prevHold) this._opennessAtPress = this.gate.openness;
    this._prevHold = held;

    this._updateGate(dt, held);

    if (this.teaching) {
      this._updateTeach(dt);
      this._updateVessels(dt);
      this._updateEffects(dt);
      return;
    }

    this.time += dt;
    this._advanceLamp();
    this._advanceWatch();
    this._spawnDue();
    this._updateVessels(dt);
    this._updateEffects(dt);

    if (this.phase === "watch" && this.time >= this.shiftSeconds) {
      const stillOut = this.vessels.some((v) => !v.resolved);
      if (!stillOut) {
        this.phase = "dawn";
        this.dawnT = 0;
        this.ctx.audio.setAmbienceIntensity(0.1);
        this._cue("dawn");
        this.ctx.announce("Dawn. The watch is over.");
      }
    }

    if (this.phase === "dawn") {
      this.dawnT += dt;
      const k = Math.min(1, this.dawnT / FEEL.dawnSeconds);
      this.sky.dawnLayer.alpha = k;
      this.stars.alpha = 1 - k;
      this.moon.alpha = 1 - k * 0.85;
      if (this.dawnT >= FEEL.dawnSeconds) this._finish();
    }
  }

  _updateGate(dt, held) {
    const g = this.gate;
    const rate = held ? 1 / FEEL.gateRaiseSeconds : -1 / FEEL.gateLowerSeconds;

    // Deliberately LINEAR, in both the simulation and the drawing.
    //
    // An eased ramp would feel heavier, and it was written that way first. It
    // was removed because the pass/refuse test reads `openness` and the bar's
    // height is drawn from the same number: any easing that makes the bar lag
    // the value makes the game do something other than what the player can
    // see, and any easing applied to the value makes the stated raise time in
    // feel.js a lie. Weight is bought instead from the slam squash, the sound
    // on the exact frame the bar lands, and the fact that the bar has real
    // travel time at all. Latency is zero by construction: the first
    // simulation step after a press already moves the bar.
    const wasOpen = g.openness > 0.02;
    g.openness = Math.max(0, Math.min(1, g.openness + rate * dt));
    if (wasOpen && g.openness <= 0.02 && g.slam <= 0) {
      g.slam = FEEL.boomSlamSeconds;
      this._cue("boomDown");
    }
    if (g.slam > 0) g.slam -= dt;
    this.ctx.padState(g.openness > FEEL.passThreshold);
  }

  _updateTeach(dt) {
    // The first vessel exists from the start and waits. It cannot be failed,
    // there is no clock on it, and no word is shown at any point.
    if (!this.vessels.length) {
      const first = this.schedule[0];
      this._spawn({ ...first, teach: true }, GEO.boomX + 520);
      this.nextSpawn = 1;
    }
    this.promptT += dt;
    const v = this.vessels[0];
    if (v && !v.resolved) {
      const waiting = v.x <= GEO.boomX + 190 + BOW[v.hull];
      if (waiting && this.gate.openness < FEEL.passThreshold) {
        v.holding = true;
        this.prompt.alpha = Math.min(
          1,
          this.prompt.alpha + dt * 1.6,
        );
      } else {
        v.holding = false;
        this.prompt.alpha = Math.max(0, this.prompt.alpha - dt * 3.4);
      }
    }
  }

  _advanceLamp() {
    while (
      this.nextLamp < this.lampTimeline.length &&
      this.time >= this.lampTimeline[this.nextLamp].t
    ) {
      const e = this.lampTimeline[this.nextLamp];
      this._setLamp(e.mark, e.hollow, true);
      this.nextLamp++;
    }
  }

  _advanceWatch() {
    const idx = this.watchBounds.findIndex((b) => this.time < b);
    const w = idx === -1 ? this.mode.watches.length - 1 : idx;
    if (w !== this.watchIndex) {
      this.watchIndex = w;
      this.fogTarget = this.mode.watches[w].fog;
      this._cue("bell");
      this.ctx.audio.setAmbienceIntensity(0.3 + this.fogTarget * 0.6);
      this.ctx.announce(`Watch ${w + 1} of ${this.mode.watches.length}.`);
      this._updateHud();
    }
  }

  _spawnDue() {
    while (
      this.nextSpawn < this.schedule.length &&
      this.time >= this.schedule[this.nextSpawn].spawnAt
    ) {
      this._spawn(this.schedule[this.nextSpawn], GEO.spawnX);
      this.nextSpawn++;
    }
  }

  _spawn(entry, atX) {
    const view = makeVessel({
      hull: entry.hull,
      mark: entry.mark,
      hollow: entry.hollow,
      contrastBoost: this.contrastBoost,
    });
    view.position.set(atX, GEO.waterline);

    const wake = new Graphics();
    wake.ellipse(0, 0, 52, 6).fill({ color: C.glitter, alpha: 0.22 });
    wake.position.set(atX + 40, GEO.waterline + 6);
    this.vesselLayer.addChild(wake);
    this.vesselLayer.addChild(view);

    const v = {
      ...entry,
      view,
      wake,
      x: atX,
      prevX: atX,
      vx: -this.speed,
      resolved: false,
      outcome: null,
      leaving: false,
      bob: this.ctx.rng.range(0, Math.PI * 2),
      revealX: this._revealX(entry.fog),
      holding: false,
      fade: 1,
      settle: 0,
    };
    this.vessels.push(v);
  }

  /** The x at which a vessel's mark becomes readable through the fog. Clamped
   *  so the readable window is never shorter than the floor. */
  _revealX(fog) {
    const floor = GEO.boomX + FEEL.minReadableSeconds * this.speed;
    const x = GEO.spawnX - (GEO.spawnX - floor) * Math.max(0, Math.min(1, fog));
    return Math.max(floor, x);
  }

  _updateVessels(dt) {
    const remove = [];
    for (const v of this.vessels) {
      v.prevX = v.x;
      v.bob += dt * 1.7;

      if (v.holding && !v.resolved) {
        // The teach vessel eases to a stop and waits, bobbing.
        v.vx += (0 - v.vx) * Math.min(1, dt * 4.5);
      } else if (!v.resolved) {
        v.vx += (-this.speed - v.vx) * Math.min(1, dt * 3.2);
      }
      v.x += v.vx * dt;

      const bowX = v.x - BOW[v.hull];
      if (!v.resolved && bowX <= GEO.boomX) {
        this._resolve(v);
      }

      if (v.resolved && v.outcome) {
        if (v.outcome === "ADMIT_OK" || v.outcome === "ADMIT_BAD") {
          if (v.x < GEO.quayEdge - 40) {
            v.fade = Math.max(0, v.fade - dt * 1.1);
            v.settle += dt;
          }
        } else {
          // Turned away: nudge, then bear off back down the channel.
          v.vx += (this.speed * 0.72 - v.vx) * Math.min(1, dt * 1.7);
          v.fade = Math.max(0, v.fade - dt * 0.34);
        }
      }

      if (v.x < GEO.despawnX || v.x > GEO.spawnX + 340 || v.fade <= 0.01) {
        remove.push(v);
      }
    }
    for (const v of remove) {
      v.view.destroy({ children: true });
      v.wake.destroy();
      this.vessels.splice(this.vessels.indexOf(v), 1);
    }
  }

  _resolve(v) {
    v.resolved = true;
    if (this.teaching) {
      // The shift clock has been frozen through the wordless teach. Start it at
      // the moment the first vessel was scheduled to arrive, so the pacing the
      // schedule was built for continues from here instead of restarting.
      this.teaching = false;
      this.time = this.schedule[0].arriveAt;
    }

    const lamp = { mark: this.lampMark, hollow: this.lampHollow };
    const isTrue = v.mark === lamp.mark && v.hollow === lamp.hollow;
    const open = this.gate.openness >= FEEL.passThreshold;
    this.stats.total++;

    if (open && isTrue) {
      v.outcome = "ADMIT_OK";
      this.stats.berthed++;
      this._pushChain("lit");
      this.ctx.motion.addTrauma(FEEL.traumaCorrectAdmit);
      if (this.ctx.motion.flashAllowed) this.flash = FEEL.flashSeconds;
      this._cue("admit");
    } else if (open && !isTrue) {
      v.outcome = "ADMIT_BAD";
      this.stats.fouled++;
      this._pushChain(this.mode.forgiving ? "hollow" : "crossed");
      this.ctx.motion.addTrauma(FEEL.traumaWrongAdmit);
      this.ctx.hitstop.hit(FEEL.hitstopWrongAdmit);
      v.view.body.tint = 0x6a2a2a;
      this._cue("foul");
      this.ctx.announce("A wrong ship got in.");
    } else if (!open && !isTrue) {
      v.outcome = "REFUSE_OK";
      this.stats.turned++;
      this._cue("turn");
    } else {
      v.outcome = "REFUSE_BAD";
      this.stats.missed++;
      this._pushChain("hollow");
      this.ctx.motion.addTrauma(FEEL.traumaWrongRefuse);
      this.ctx.hitstop.hit(FEEL.hitstopWrongRefuse);
      v.view.cabinLamp.alpha = 0.12;
      this._cue("miss");
    }
    this._updateHud();
  }

  _pushChain(kind) {
    this.chain.push(kind);
    this.chainPop = this.chain.length - 1;
    this.chainPopT = FEEL.lanternPopSeconds;
    this._redrawChain();
  }

  _redrawChain() {
    const g = this.chainLayer;
    g.clear();
    for (let i = 0; i < this.chain.length; i++) {
      const row = Math.floor(i / GEO.chainPerRow);
      const col = i % GEO.chainPerRow;
      const x = GEO.chainX + col * GEO.chainStep;
      const y = GEO.chainY + row * GEO.chainRowStep;
      drawChainMark(g, this.chain[i], x, y);
    }
  }

  _setLamp(mark, hollow, animate) {
    this.lampMark = mark;
    this.lampHollow = hollow;
    setLampMark(this.lamp, mark, hollow);
    if (animate) {
      this.lampPop = 0.55;
      this._cue("lamp");
      this.ctx.announce(
        `The lamp changed. It now shows a ${hollow ? "hollow " : ""}${markName(mark)}.`,
      );
    }
    this._updateHud();
  }

  _updateEffects(dt) {
    if (this.flash > 0) this.flash -= dt;
    if (this.lampPop > 0) this.lampPop -= dt;
    if (this.chainPopT > 0) this.chainPopT -= dt;
    this.fogNow += (this.fogTarget - this.fogNow) * Math.min(1, dt * 0.7);
  }

  // ---------------------------------------------------------------- render --

  render(alpha) {
    const t = performance.now() / 1000;

    // Boom. Interpolating the bar between simulation states is what keeps a
    // held press feeling continuous rather than stepped at 60Hz.
    const open = this.gate.openness;
    const slamSquash =
      this.gate.slam > 0
        ? 1 + FEEL.boomSlamSquash * (this.gate.slam / FEEL.boomSlamSeconds)
        : 1;
    this.boom.bar.y = -open * GEO.boomTravel;
    this.boom.bar.scale.set(slamSquash, 1 / slamSquash);

    // Vessels: interpolate x, add a small bob, and hide the mark inside fog.
    for (const v of this.vessels) {
      const x = v.prevX + (v.x - v.prevX) * alpha;
      v.view.x = x;
      v.view.y = GEO.waterline + Math.sin(v.bob) * 2.4;
      v.view.rotation = Math.sin(v.bob * 0.7) * 0.008;
      v.view.alpha = v.fade;
      v.wake.x = x + 44;
      v.wake.alpha = 0.22 * v.fade * (v.resolved ? 0.4 : 1);
      v.wake.scale.x = 1 + Math.sin(v.bob * 2) * 0.06;

      // The fog hides the INFORMATION and nothing else, which is why the
      // vessel stays visible while its mark does not.
      const revealed = x <= v.revealX;
      const fade = revealed
        ? 1
        : Math.max(0, 1 - (x - v.revealX) / 260);
      v.view.pennant.alpha = fade;
      v.view.pennant.scale.set(0.86 + 0.14 * fade);

      if (v.outcome === "ADMIT_OK" || v.outcome === "ADMIT_BAD") {
        v.view.scale.set(1 - Math.min(0.35, v.settle * 0.22));
      }
    }

    // Lamp pop on a rule change: scale overshoot plus a brighter halo. This is
    // the beat the whole mechanic turns on, so it gets the biggest effect in
    // the game that is not an error.
    const pop = Math.max(0, this.lampPop) / 0.55;
    this.lamp.markLayer.scale.set(1 + pop * 0.55);
    this.lamp.glow.alpha = 0.34 + pop * 0.5;
    this.lamp.glow.scale.set(1 + pop * 0.25);

    // Prompt breathing.
    if (this.prompt.alpha > 0.01) {
      const b = 1 + Math.sin(t * 4.2) * 0.12;
      this.promptRing.scale.set(b);
      this.prompt.y = GEO.waterline - 92 - Math.sin(t * 4.2) * 6;
    }

    // Glitter on the water.
    for (const g of this.glitter.children) {
      g.alpha = g.baseAlpha * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * g.speed + g.phase)));
    }

    // Fog drift.
    for (const band of this.fogLayer.children) {
      band.x -= band.driftSpeed * 0.016;
      if (band.x < -VIEW.w * 0.4) band.x = VIEW.w;
      band.alpha = band.baseAlpha * this.fogNow;
    }

    // Chain pop.
    if (this.chainPopT > 0) {
      const k = this.chainPopT / FEEL.lanternPopSeconds;
      this.chainLayer.scale.set(1 + (FEEL.lanternPopScale - 1) * k * 0.06);
    } else {
      this.chainLayer.scale.set(1);
    }

    this.flashLayer.alpha =
      this.flash > 0 ? (this.flash / FEEL.flashSeconds) * 0.16 : 0;
  }

  resize(w, h) {
    const scale = Math.min(w / VIEW.w, h / VIEW.h);
    this.root.scale.set(scale);
    this.root.x = (w - VIEW.w * scale) / 2;
    this.root.y = (h - VIEW.h * scale) / 2;
  }

  settingsChanged() {
    const boost = this.ctx.settings.contrast === "high";
    if (boost === this.contrastBoost) return;
    this.contrastBoost = boost;
    for (const v of this.vessels) v.view.pennant.scale.set(boost ? 1.2 : 1);
    this.lamp.contrastBoost = boost;
    setLampMark(this.lamp, this.lampMark, this.lampHollow);
  }

  // ----------------------------------------------------------------- audio --

  _cue(name) {
    const a = this.ctx.audio;
    if (!a.unlocked) return;
    const j = () => 1 + (Math.random() * 2 - 1) * 0.06;
    switch (name) {
      case "admit":
        a.tone({ freq: 523.25 * j(), type: "triangle", gain: FEEL.cueGainAdmit, decay: 0.2, cutoff: 3200 });
        a.tone({ freq: 783.99 * j(), type: "sine", gain: FEEL.cueGainAdmit * 0.7, decay: 0.34, delay: 0.055 });
        a.noise({ dur: 0.16, freq: 2400, to: 700, gain: 0.07, q: 0.9 });
        break;
      case "turn":
        a.noise({ dur: 0.13, freq: 420 * j(), to: 180, gain: FEEL.cueGainRefuse * 0.55, q: 2.2 });
        a.tone({ freq: 146.83 * j(), type: "sine", gain: FEEL.cueGainRefuse * 0.5, decay: 0.24, cutoff: 700 });
        break;
      case "foul":
        a.tone({ freq: 92 * j(), to: 58, type: "sawtooth", gain: FEEL.cueGainWrong, decay: 0.5, cutoff: 480 });
        a.tone({ freq: 138 * j(), type: "square", gain: FEEL.cueGainWrong * 0.34, decay: 0.36, cutoff: 620 });
        a.noise({ dur: 0.34, freq: 300, to: 90, gain: 0.2, q: 0.7 });
        break;
      case "miss":
        a.tone({ freq: 233.08, to: 155.56, type: "sine", gain: 0.26, decay: 0.75, cutoff: 900 });
        break;
      case "lamp":
        a.tone({ freq: 1174.66, type: "sine", gain: FEEL.cueGainLamp, decay: 0.9, bus: "ui" });
        a.tone({ freq: 1567.98, type: "sine", gain: FEEL.cueGainLamp * 0.55, decay: 0.7, delay: 0.09, bus: "ui" });
        a.tone({ freq: 880, type: "sine", gain: FEEL.cueGainLamp * 0.4, decay: 1.1, delay: 0.19, bus: "ui" });
        break;
      case "bell":
        a.tone({ freq: 659.25, type: "sine", gain: 0.3, decay: 1.4, bus: "ui" });
        a.tone({ freq: 659.25, type: "sine", gain: 0.26, decay: 1.4, delay: 0.4, bus: "ui" });
        break;
      case "boomDown":
        a.noise({ dur: 0.1, freq: 260, to: 90, gain: 0.16, q: 1.4 });
        a.tone({ freq: 74, type: "sine", gain: 0.2, decay: 0.18, cutoff: 320 });
        break;
      case "dawn":
        [261.63, 329.63, 392, 523.25].forEach((f, i) =>
          a.tone({ freq: f, type: "sine", gain: 0.2, decay: 2.4, delay: i * 0.17, bus: "ui" }),
        );
        break;
    }
  }

  // ------------------------------------------------------------------- hud --

  _updateHud() {
    const pips = this.mode.watches
      .map((_, i) => {
        const done = i < this.watchIndex;
        const now = i === this.watchIndex;
        return `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">${
          done
            ? '<circle cx="8" cy="8" r="6" fill="currentColor"/>'
            : now
              ? '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/>'
              : '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"/>'
        }</svg>`;
      })
      .join("");
    this.ctx.setHud(
      `<span class="visually-hidden">Watch ${this.watchIndex + 1} of ${this.mode.watches.length}. The lamp shows a ${this.lampHollow ? "hollow " : ""}${markName(this.lampMark)}. ${this.stats.berthed} berthed, ${this.stats.missed} missed, ${this.stats.fouled} let in wrongly.</span><span aria-hidden="true" style="display:flex;gap:6px;align-items:center">${pips}</span>`,
    );
  }

  // ---------------------------------------------------------------- finish --

  _finish() {
    if (this.finished) return;
    this.finished = true;
    this.phase = "done";

    const s = this.stats;
    const decided = s.berthed + s.missed + s.fouled + s.turned;
    const right = s.berthed + s.turned;
    const accuracy = decided ? Math.round((right / decided) * 100) : 0;

    const rec = this.ctx.save.game("harbor-watch");
    if (!rec.best) rec.best = {};
    const prev = rec.best[this.mode.id];
    const isBetter = !prev || s.berthed > prev.berthed;
    if (isBetter) rec.best[this.mode.id] = { berthed: s.berthed, accuracy };
    this.ctx.save.flush();

    const quay = this.chain.map((k) => CHAIN_SVG[k]);

    this.ctx.finish({
      headline: "Dawn. The watch is over.",
      summary:
        s.fouled === 0 && s.missed === 0
          ? "Every vessel judged correctly, from dusk to first light."
          : "This is the harbour you kept tonight.",
      quay,
      quayLabel: `${s.berthed} lit lanterns for ships berthed, ${s.missed} unlit for ships you turned away by mistake, ${s.fouled} crossed for ships that should not have been let in.`,
      tally: [
        { glyph: CHAIN_SVG.lit, value: s.berthed, label: "berthed" },
        { glyph: CHAIN_SVG.hollow, value: s.missed, label: "turned away by mistake" },
        { glyph: CHAIN_SVG.crossed, value: s.fouled, label: "let in by mistake" },
        {
          glyph:
            '<svg viewBox="0 0 22 26" width="22" height="26" aria-hidden="true"><path d="M3 20h16M6 20V9l5-5 5 5v11" fill="none" stroke="#6f7f97" stroke-width="2"/></svg>',
          value: s.turned,
          label: "correctly turned back",
        },
      ],
      bestLine: prev
        ? `Your best on ${this.mode.name} before tonight: ${prev.berthed} berthed.`
        : null,
      modeName: this.mode.name,
      durationMs: (this.time + this.dawnT) * 1000,
      accuracy,
      stats: { ...s },
    });
  }

  abandon() {
    this.finished = true;
  }

  // -------------------------------------------------------------- harness ---

  /** Read by the shell's input-latency probe: true once the gate has actually
   *  moved since the most recent press. */
  verbMoved() {
    return this.gate.openness > this._opennessAtPress + 0.0005;
  }

  snapshot() {
    return {
      time: +this.time.toFixed(3),
      phase: this.phase,
      teaching: this.teaching,
      watch: this.watchIndex,
      gate: +this.gate.openness.toFixed(4),
      gateOpen: this.gate.openness >= FEEL.passThreshold,
      lamp: this.lampMark,
      lampHollow: this.lampHollow,
      onWater: this.vessels.length,
      unresolved: this.vessels.filter((v) => !v.resolved).length,
      scheduled: this.schedule.length,
      spawned: this.nextSpawn,
      chain: this.chain.length,
      stats: { ...this.stats },
      nextVessel: this._nextVesselInfo(),
      shiftSeconds: +this.shiftSeconds.toFixed(2),
    };
  }

  /** What the harness needs to play the game correctly: the mark of the next
   *  unresolved vessel and how far it is from the boom. */
  _nextVesselInfo() {
    let best = null;
    for (const v of this.vessels) {
      if (v.resolved) continue;
      if (!best || v.x < best.x) best = v;
    }
    if (!best) return null;
    return {
      mark: best.mark,
      hollow: best.hollow,
      matches: best.mark === this.lampMark && best.hollow === this.lampHollow,
      distanceToBoom: +(best.x - BOW[best.hull] - GEO.boomX).toFixed(1),
      secondsToBoom: +(
        (best.x - BOW[best.hull] - GEO.boomX) / this.speed
      ).toFixed(3),
      revealed: best.x <= best.revealX,
    };
  }

  teardown() {
    this.root.destroy({ children: true });
  }
}

function markName(id) {
  return MARKS.find((m) => m.id === id)?.name ?? id;
}

/** Exported for the fairness test, which rebuilds schedules across many seeds
 *  without a browser. */
export { BOW, drawMark };
