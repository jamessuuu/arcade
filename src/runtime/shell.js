/**
 * THE HOUSE SHELL.
 *
 * This is the file that decides whether a portal of twenty games is possible
 * at solo scale. The unit cost of game N is dominated by everything that is
 * not the mechanic: the loop, input, settings, save, audio unlock, pause,
 * results, accessibility, and the whole "last 10 percent" that the program
 * costs at 36% of a game's budget. All of it is here, once.
 *
 * A game gets: a Pixi container, a fixed-step update, an interpolated render,
 * and a `finish()` call. It implements a mechanic. It never draws a menu,
 * never touches localStorage, never reads a keyboard event, never asks about
 * reduced motion, and never renders a word.
 *
 * The menus are HTML, not canvas. That single decision is why the keyboard
 * works, why a screen reader can read the shell, why focus is visible, and why
 * the 44px target floor can be measured from the DOM instead of asserted.
 */

import { Application, Container } from "pixi.js";
import { Loop } from "./loop.js";
import { Input } from "./input.js";
import { Save } from "./save.js";
import { AudioBus } from "./audio.js";
import { Motion, Hitstop } from "./motion.js";
import { makeRng, freshSeed } from "./rng.js";
import { installHarness } from "./harness.js";

const ICON = {
  pause: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
};

export class Shell {
  constructor(gameModule, host) {
    this.module = gameModule;
    this.manifest = gameModule.manifest;
    this.host = host;

    this.save = new Save();
    this.settings = this.save.settings;
    this.audio = new AudioBus(this.settings);
    this.motion = new Motion(this.settings, null);
    this.hitstop = new Hitstop();
    this.input = new Input({ bufferMs: 120 });

    this.state = "title"; // title | playing | paused | results
    this.game = null;
    this.mode = this.settings.mode || "standard";
    this.seed = freshSeed();
    this.result = null;
    this.startedAt = 0;

    /** Instrumentation for the harness: press timestamp -> first frame that
     *  actually rendered a changed world. This is an in-page proxy for input
     *  latency, not a photometric measurement, and it is labelled as such
     *  everywhere it is reported. */
    this.latency = { samples: [], pendingPressAt: -1 };

    this.loop = new Loop(
      (dt) => this._update(dt),
      (alpha, frameMs) => this._render(alpha, frameMs),
    );
  }

  async boot() {
    this._applyTheme();
    this._buildDom();

    this.app = new Application();
    await this.app.init({
      resizeTo: this.canvasHost,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
      background: this.manifest.ground ?? 0x0d1b2a,
      autoStart: false,
      preference: "webgl",
    });
    this.app.ticker.stop();
    this.canvasHost.insertBefore(this.app.canvas, this.holdPad);
    this.app.canvas.setAttribute("aria-hidden", "true");

    this.world = new Container();
    this.app.stage.addChild(this.world);

    this.input.attach(this.canvasHost);
    this.input._onAction = (action, isDown, source, at) =>
      this._onAction(action, isDown, source, at);

    this._wireHoldPad();
    this._bindResize();
    this.loop.start();
    this._showTitle();

    installHarness(this);
    document.documentElement.dataset.shellReady = "1";
    return this;
  }

  // ---------------------------------------------------------------- DOM ----

  _buildDom() {
    this.host.innerHTML = `
      <a class="skip-link" href="#shellControls">Skip to the game controls</a>
      <div class="stage">
        <div class="stage__bar" id="shellControls">
          <a class="btn" href="./index.html" id="leaveBtn" aria-label="Leave this game and go back to the arcade">
            ${ICON.back}<span class="visually-hidden">Back to the arcade</span>
          </a>
          <h1 class="stage__title">${escapeHtml(this.manifest.title)}</h1>
          <div id="hudSlot" class="hud"></div>
          <button type="button" class="btn" id="pauseBtn" aria-label="Pause">
            ${ICON.pause}<span class="visually-hidden">Pause</span>
          </button>
        </div>
        <div class="stage__canvas" id="canvasHost" data-game-surface>
          <button type="button" class="hold-pad" id="holdPad" data-game-surface
                  aria-label="${escapeHtml(this.manifest.verbLabel ?? "Hold")}"
                  data-held="false" hidden>
            <span id="holdPadGlyph" aria-hidden="true"></span>
          </button>
          <div class="overlay" id="overlay" role="dialog" aria-modal="true"
               aria-labelledby="sheetHeading"></div>
          <p class="visually-hidden" id="liveRegion" role="status" aria-live="polite"></p>
        </div>
      </div>`;

    this.canvasHost = this.host.querySelector("#canvasHost");
    this.overlay = this.host.querySelector("#overlay");
    this.holdPad = this.host.querySelector("#holdPad");
    this.holdPadGlyph = this.host.querySelector("#holdPadGlyph");
    this.hudSlot = this.host.querySelector("#hudSlot");
    this.liveRegion = this.host.querySelector("#liveRegion");
    this.pauseBtn = this.host.querySelector("#pauseBtn");

    this.holdPadGlyph.innerHTML = this.manifest.padGlyph ?? "";
    this.pauseBtn.addEventListener("click", () => {
      this.audio.unlock();
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
    });
    document.body.classList.add("playing");
  }

  _wireHoldPad() {
    const down = (e) => {
      e.preventDefault();
      this.audio.unlock();
      if (this.state !== "playing") return;
      this.holdPad.dataset.held = "true";
      this.input.press("hold", "pad-ui", e.timeStamp);
    };
    const up = (e) => {
      this.holdPad.dataset.held = "false";
      this.input.release("hold", "pad-ui", e.timeStamp);
    };
    this.holdPad.addEventListener("pointerdown", down);
    this.holdPad.addEventListener("pointerup", up);
    this.holdPad.addEventListener("pointercancel", up);
    this.holdPad.addEventListener("pointerleave", up);
    // The pad is a real <button>, so it also receives keyboard activation. A
    // keydown on it must behave like a hold, not like a click.
    this.holdPad.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "Enter") e.preventDefault();
    });
  }

  _bindResize() {
    const ro = new ResizeObserver(() => {
      const w = this.canvasHost.clientWidth;
      const h = this.canvasHost.clientHeight;
      if (w > 0 && h > 0) this.game?.resize?.(w, h);
    });
    ro.observe(this.canvasHost);
    this._resizeObserver = ro;
  }

  _applyTheme() {
    const root = document.documentElement;
    root.dataset.theme = this.settings.theme || "system";
    root.dataset.contrast = this.settings.contrast || "normal";
  }

  announce(text) {
    if (!this.liveRegion) return;
    this.liveRegion.textContent = "";
    // A same-text update is not announced by some screen readers unless the
    // node actually changes, hence the reset then a task-queue write.
    setTimeout(() => {
      this.liveRegion.textContent = text;
    }, 30);
  }

  setHud(html) {
    this.hudSlot.innerHTML = html;
  }

  // ------------------------------------------------------------- states ----

  _openSheet(html, focusSelector) {
    this.overlay.innerHTML = `<div class="sheet">${html}</div>`;
    this.overlay.hidden = false;
    this.holdPad.hidden = true;
    const target =
      this.overlay.querySelector(focusSelector ?? "") ??
      this.overlay.querySelector("button, [href], input, select");
    target?.focus();
    this._trapFocus();
  }

  _closeSheet() {
    this.overlay.hidden = true;
    this.overlay.innerHTML = "";
    this._untrapFocus();
  }

  _trapFocus() {
    if (this._trapHandler) return;
    this._trapHandler = (e) => {
      if (e.key !== "Tab" || this.overlay.hidden) return;
      const items = [
        ...this.overlay.querySelectorAll(
          'button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", this._trapHandler, true);
  }

  _untrapFocus() {
    if (!this._trapHandler) return;
    window.removeEventListener("keydown", this._trapHandler, true);
    this._trapHandler = null;
  }

  _showTitle() {
    this.state = "title";
    this.loop.setPaused(true);
    this.setHud("");
    const modes = this.manifest.modes
      .map(
        (m) => `
        <li><button type="button" class="choice" data-mode="${m.id}"
              aria-pressed="${m.id === this.mode}">
          <span class="choice__glyph" aria-hidden="true">${m.glyph ?? ""}</span>
          <span>
            <span class="choice__name">${escapeHtml(m.name)}</span>
            <span class="choice__desc">${escapeHtml(m.description)}</span>
          </span>
        </button></li>`,
      )
      .join("");

    this._openSheet(
      `<h2 id="sheetHeading">${escapeHtml(this.manifest.title)}</h2>
       <p>${escapeHtml(this.manifest.tagline)}</p>
       <ul class="choices" aria-label="Choose how long and how hard">${modes}</ul>
       <div class="sheet__actions">
         <button type="button" class="btn btn--primary btn--big" id="playBtn">Play</button>
         <button type="button" class="btn" id="settingsBtn">Settings</button>
         <a class="btn" href="./index.html">Back to the arcade</a>
       </div>`,
      "#playBtn",
    );

    this.overlay.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.mode = btn.dataset.mode;
        this.save.set("settings.mode", this.mode);
        this.overlay
          .querySelectorAll("[data-mode]")
          .forEach((b) =>
            b.setAttribute("aria-pressed", String(b.dataset.mode === this.mode)),
          );
      });
    });
    this.overlay.querySelector("#playBtn").addEventListener("click", () => {
      this.audio.unlock();
      this.start();
    });
    this.overlay
      .querySelector("#settingsBtn")
      .addEventListener("click", () => this._showSettings(() => this._showTitle()));
  }

  start(opts = {}) {
    this.audio.unlock();
    this.audio.applySettings();
    this.seed = opts.seed ?? freshSeed();
    if (opts.mode) this.mode = opts.mode;

    this._closeSheet();
    this.holdPad.hidden = false;
    this.holdPad.dataset.held = "false";
    this.motion.reset();
    this.hitstop.reset();
    this.latency = { samples: [], pendingPressAt: -1 };
    this.loop.resetFrameStats();
    this.result = null;

    if (this.game) {
      this.game.teardown?.();
      this.world.removeChildren();
    }
    const rng = makeRng(this.seed);
    this.motion.rng = rng;

    this.game = this.module.createGame(this._makeCtx(rng));
    this.game.init(this.mode);
    this.game.resize?.(this.canvasHost.clientWidth, this.canvasHost.clientHeight);

    this.state = "playing";
    this.startedAt = performance.now();
    this.loop.setPaused(false);
    this.audio.startAmbience();
    // Focus the canvas host so keyboard input is not sitting on a stale button.
    this.canvasHost.setAttribute("tabindex", "-1");
    this.canvasHost.focus({ preventScroll: true });
  }

  _makeCtx(rng) {
    return {
      app: this.app,
      stage: this.world,
      rng,
      seed: this.seed,
      audio: this.audio,
      motion: this.motion,
      hitstop: this.hitstop,
      input: this.input,
      save: this.save,
      settings: this.settings,
      width: () => this.canvasHost.clientWidth,
      height: () => this.canvasHost.clientHeight,
      announce: (t) => this.announce(t),
      setHud: (h) => this.setHud(h),
      finish: (result) => this.finish(result),
      padState: (open) => {
        this.holdPad.dataset.open = open ? "true" : "false";
      },
    };
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.loop.setPaused(true);
    this.input.releaseAll("pause");
    this.audio.suspend();
    this._openPauseSheet();
  }

  /** Separate from pause() because closing Settings has to bring the pause
   *  sheet back while the shell is ALREADY paused. Routing that through
   *  pause() hit its own "only from playing" guard, closed the settings sheet
   *  and opened nothing: the game sat paused behind an empty overlay with no
   *  way back except the keyboard. */
  _openPauseSheet() {
    this._openSheet(
      `<h2 id="sheetHeading">Paused</h2>
       <p>The watch is held. Nothing is running while this is open.</p>
       <div class="sheet__actions">
         <button type="button" class="btn btn--primary btn--big" id="resumeBtn">Resume</button>
         <button type="button" class="btn" id="pauseSettingsBtn">Settings</button>
         <button type="button" class="btn" id="endBtn">End this run</button>
         <a class="btn" href="./index.html">Back to the arcade</a>
       </div>`,
      "#resumeBtn",
    );
    this.overlay
      .querySelector("#resumeBtn")
      .addEventListener("click", () => this.resume());
    this.overlay
      .querySelector("#pauseSettingsBtn")
      .addEventListener("click", () => this._showSettings(() => this._openPauseSheet()));
    this.overlay.querySelector("#endBtn").addEventListener("click", () => {
      this.game?.abandon?.();
      this._showTitle();
    });
  }

  resume() {
    if (this.state !== "paused") return;
    this._closeSheet();
    this.holdPad.hidden = false;
    this.state = "playing";
    this.loop.setPaused(false);
    this.audio.resume();
    this.canvasHost.focus({ preventScroll: true });
  }

  finish(result) {
    if (this.state === "results") return;
    this.state = "results";
    this.result = result;
    this.loop.setPaused(true);
    this.input.releaseAll("finish");
    this.audio.stopAmbience();

    const tally = (result.tally ?? [])
      .map(
        (t) => `<li>
          <span aria-hidden="true">${t.glyph ?? ""}</span>
          <span><b>${escapeHtml(String(t.value))}</b><span>${escapeHtml(t.label)}</span></span>
        </li>`,
      )
      .join("");

    const quay = result.quay?.length
      ? `<div class="quay-strip" role="img" aria-label="${escapeHtml(result.quayLabel ?? "The quay you built")}">${result.quay.join("")}</div>`
      : "";

    const best = result.bestLine
      ? `<p class="field__hint">${escapeHtml(result.bestLine)}</p>`
      : "";

    this._openSheet(
      `<h2 id="sheetHeading">${escapeHtml(result.headline)}</h2>
       <p>${escapeHtml(result.summary ?? "")}</p>
       ${quay}
       <ul class="tally">${tally}</ul>
       ${best}
       <p class="field__hint">Run seed <code>${this.seed}</code> &middot; ${Math.round((result.durationMs ?? 0) / 1000)} seconds &middot; ${escapeHtml(result.modeName ?? this.mode)}</p>
       <div class="sheet__actions">
         <button type="button" class="btn btn--primary btn--big" id="againBtn">Play again</button>
         <button type="button" class="btn" id="titleBtn">Change how you play</button>
         <a class="btn" href="./index.html">Back to the arcade</a>
       </div>`,
      "#againBtn",
    );
    this.overlay
      .querySelector("#againBtn")
      .addEventListener("click", () => this.start());
    this.overlay
      .querySelector("#titleBtn")
      .addEventListener("click", () => this._showTitle());
    this.announce(result.headline);
  }

  _showSettings(onClose) {
    const s = this.settings;
    const seg = (name, options, current) =>
      options
        .map(
          (o) =>
            `<button type="button" class="btn" data-set="${name}" data-value="${o.value}" aria-pressed="${String(o.value) === String(current)}">${escapeHtml(o.label)}</button>`,
        )
        .join("");

    const recovery = this.save.lastRecovery
      ? `<div class="panel"><p><strong>Your saved progress could not be read, so it was reset.</strong> Reason recorded: <code>${escapeHtml(this.save.lastRecovery)}</code>. Nothing was sent anywhere; the unreadable copy is still on this device under <code>arcade.save.v1.broken</code> until you erase it.</p></div>`
      : "";

    this._openSheet(
      `<h2 id="sheetHeading">Settings</h2>
       ${recovery}
       <div class="field">
         <span class="field__label" id="lbl-motion">Movement</span>
         <p class="field__hint">"Follow my device" uses your system's reduce-motion setting.</p>
         <div class="seg" role="group" aria-labelledby="lbl-motion">
           ${seg("motion", [{ value: "auto", label: "Follow my device" }, { value: "reduced", label: "Calm" }, { value: "full", label: "Full" }], s.motion)}
         </div>
       </div>
       <div class="field">
         <label class="field__label" for="shakeRange">Screen shake</label>
         <p class="field__hint">Slide to zero to switch it off completely.</p>
         <input type="range" id="shakeRange" min="0" max="1" step="0.1" value="${Number(s.shake)}"
                aria-describedby="shakeVal">
         <output id="shakeVal" class="field__hint">${Math.round(Number(s.shake) * 100)}%</output>
       </div>
       <div class="field">
         <span class="field__label" id="lbl-flash">Bright flashes</span>
         <p class="field__hint">Turns off every full-screen brightness change.</p>
         <div class="seg" role="group" aria-labelledby="lbl-flash">
           ${seg("flash", [{ value: "true", label: "On" }, { value: "false", label: "Off" }], String(s.flash))}
         </div>
       </div>
       <div class="field">
         <label class="field__label" for="volMaster">Overall volume</label>
         <input type="range" id="volMaster" min="0" max="1" step="0.05" value="${Number(s.volumeMaster)}">
       </div>
       <div class="field">
         <label class="field__label" for="volAmb">Background sound</label>
         <input type="range" id="volAmb" min="0" max="1" step="0.05" value="${Number(s.volumeAmbience)}">
       </div>
       <div class="field">
         <span class="field__label" id="lbl-contrast">Contrast</span>
         <div class="seg" role="group" aria-labelledby="lbl-contrast">
           ${seg("contrast", [{ value: "normal", label: "Normal" }, { value: "high", label: "High" }], s.contrast)}
         </div>
       </div>
       <div class="field">
         <span class="field__label" id="lbl-theme">Theme</span>
         <div class="seg" role="group" aria-labelledby="lbl-theme">
           ${seg("theme", [{ value: "system", label: "Follow my device" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }], s.theme)}
         </div>
       </div>
       <div class="field">
         <span class="field__label">Keys</span>
         <p class="field__hint">Hold with <kbd>Space</kbd>, <kbd>Enter</kbd> or <kbd>Up arrow</kbd>. Pause with <kbd>Esc</kbd>. A gamepad works too: any face button holds.</p>
       </div>
       <div class="sheet__actions">
         <button type="button" class="btn btn--primary btn--big" id="closeSettings">Done</button>
       </div>`,
      "#closeSettings",
    );

    this.overlay.querySelectorAll("[data-set]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.set;
        let value = btn.dataset.value;
        if (value === "true") value = true;
        else if (value === "false") value = false;
        this.save.set("settings." + key, value);
        this.overlay
          .querySelectorAll(`[data-set="${key}"]`)
          .forEach((b) =>
            b.setAttribute(
              "aria-pressed",
              String(String(b.dataset.value) === String(value)),
            ),
          );
        this._applyTheme();
        this.audio.applySettings();
        this.game?.settingsChanged?.();
      });
    });

    const range = (id, key, fmt) => {
      const el = this.overlay.querySelector("#" + id);
      el?.addEventListener("input", () => {
        this.save.set("settings." + key, Number(el.value));
        this.audio.applySettings();
        if (fmt) fmt(el.value);
        this.game?.settingsChanged?.();
      });
    };
    const shakeVal = this.overlay.querySelector("#shakeVal");
    range("shakeRange", "shake", (v) => {
      if (shakeVal) shakeVal.textContent = Math.round(Number(v) * 100) + "%";
    });
    range("volMaster", "volumeMaster");
    range("volAmb", "volumeAmbience");

    this.overlay.querySelector("#closeSettings").addEventListener("click", () => {
      this._closeSheet();
      onClose?.();
    });
  }

  // -------------------------------------------------------------- frame ----

  _onAction(action, isDown, source, at) {
    if (action === "pause" && isDown) {
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
      return;
    }
    if (action === "hold" && this.state === "playing") {
      this.audio.unlock();
      this.holdPad.dataset.held = isDown ? "true" : "false";
      if (isDown) this.latency.pendingPressAt = at ?? performance.now();
    }
  }

  _update(dt) {
    if (this.state !== "playing") return;
    this.motion.update(dt);
    if (this.hitstop.consume(dt)) return;
    this.game?.update(dt, this.input);
  }

  _render(alpha, frameMs) {
    if (this.game) {
      this.game.render?.(alpha, frameMs);
      // Camera shake is applied by the shell, not by the game, so the shake
      // setting cannot be forgotten by a game author.
      this.world.x = this.motion.offsetX;
      this.world.y = this.motion.offsetY;
      this.world.rotation = this.motion.rotation;
      // Latency probe: the first frame after a press on which the game reports
      // its verb state actually moved.
      if (this.latency.pendingPressAt >= 0 && this.game.verbMoved?.()) {
        const dtms = performance.now() - this.latency.pendingPressAt;
        if (dtms >= 0 && dtms < 500) this.latency.samples.push(+dtms.toFixed(2));
        this.latency.pendingPressAt = -1;
      }
    }
    this.app.renderer.render(this.app.stage);
  }

  destroy() {
    this.loop.stop();
    this.input.detach();
    this._resizeObserver?.disconnect();
    this.game?.teardown?.();
    this.audio.stopAmbience();
    this.app?.destroy(true);
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

export async function mountGame(gameModule, host = document.getElementById("app")) {
  const shell = new Shell(gameModule, host);
  await shell.boot();
  return shell;
}
