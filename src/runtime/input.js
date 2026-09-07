/**
 * The house input layer.
 *
 * Games never see a KeyboardEvent. They see ACTIONS — `hold`, `confirm`,
 * `back`, `pause` — and every action is available from a keyboard, from a
 * pointer or thumb, and from a gamepad, simultaneously, with no game-side
 * code. That is the whole reason this file exists: game 2 gets full keyboard
 * play, touch play and gamepad play for free, and the accessibility floor
 * ("every input remappable, keyboard-complete, 44px targets") is satisfied by
 * infrastructure rather than by remembering.
 *
 * The buffer is the other half. A press the player felt they made must never
 * silently vanish, so a press is remembered for `bufferMs` and can be consumed
 * slightly late by whatever was not ready for it yet. Section 6 of the program
 * calls for ~100-150ms; the constant lives in feel.js and belongs to James.
 */

const DEFAULT_BINDINGS = {
  hold: ["Space", "Enter", "ArrowUp", "KeyZ", "KeyJ", "NumpadEnter"],
  pause: ["Escape", "KeyP"],
  confirm: ["Enter", "Space"],
  back: ["Escape", "Backspace"],
};

/** Gamepad button indices in the Standard Gamepad mapping. */
const PAD_BINDINGS = {
  hold: [0, 2, 7, 6], // A, X, RT, LT
  pause: [9], // Start
  confirm: [0],
  back: [1],
};

export class Input {
  constructor(options = {}) {
    this.bufferMs = options.bufferMs ?? 120;
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.enabled = true;

    /** action -> { down, pressedAt, releasedAt, pressCount, releaseCount,
     *              consumedPress, sources:Set } */
    this.state = Object.create(null);
    for (const name of Object.keys(this.bindings)) this._ensure(name);

    this._padPrev = Object.create(null);
    this._listeners = [];
    this._onAction = options.onAction || null;
    this._padPollHandle = 0;
  }

  _ensure(name) {
    if (!this.state[name]) {
      this.state[name] = {
        down: false,
        pressedAt: -1,
        releasedAt: -1,
        pressCount: 0,
        releaseCount: 0,
        lastPressConsumed: true,
        sources: new Set(),
      };
    }
    return this.state[name];
  }

  attach(target) {
    const add = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this._listeners.push(() => el.removeEventListener(type, fn, opts));
    };

    const codeToActions = (code) => {
      const out = [];
      for (const [action, codes] of Object.entries(this.bindings)) {
        if (codes.includes(code)) out.push(action);
      }
      return out;
    };

    add(window, "keydown", (e) => {
      if (!this.enabled) return;
      // Never swallow the browser's own affordances.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // If focus is inside a real control, the control wins. This is what lets
      // the whole shell stay keyboard-operable while a game is bound to Space.
      //
      // The exception is anything marked `data-game-surface`: the canvas host
      // and the hold pad ARE the game, and the game must receive Space when
      // they hold focus. Getting this wrong is silent and total — the first
      // version of this guard treated the focused canvas host as a control
      // because it carries tabindex, so every keypress was swallowed and the
      // game looked alive but could not be played at all.
      //
      // The overlay is a CHILD of the game surface, so it has to be excluded
      // explicitly or every menu button loses its keyboard activation: Enter
      // on a focused button would be preventDefault-ed here and read as the
      // game verb instead of as a press. That is the same root cause as the
      // pointer-capture defect below — menus live inside the surface — and it
      // is why both guards name the overlay rather than assuming containment
      // implies ownership.
      const t = e.target;
      const inOverlay = (t?.closest?.(".overlay") ?? null) !== null;
      const isSurface =
        !inOverlay &&
        (!t ||
          t === document.body ||
          t === document.documentElement ||
          (t.closest?.("[data-game-surface]") ?? null) !== null);
      if (
        !isSurface &&
        (t.matches?.(
          'button, a[href], input, select, textarea, summary, [contenteditable="true"]',
        ) ??
          false)
      ) {
        // `pause` is the one action that still fires from anywhere.
        if (!this.bindings.pause.includes(e.code)) return;
      }
      const actions = codeToActions(e.code);
      if (!actions.length) return;
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      for (const a of actions) this.press(a, "key", e.timeStamp);
    });

    add(window, "keyup", (e) => {
      if (!this.enabled) return;
      for (const a of codeToActions(e.code)) this.release(a, "key", e.timeStamp);
    });

    // A press with the window unfocused would otherwise stick down forever.
    add(window, "blur", () => this.releaseAll("blur"));
    add(document, "visibilitychange", () => {
      if (document.hidden) this.releaseAll("hidden");
    });

    if (target) {
      add(
        target,
        "pointerdown",
        (e) => {
          if (!this.enabled) return;
          if (e.button !== 0 && e.pointerType === "mouse") return;

          // ONLY the drawing surface starts a hold.
          //
          // This guard is not defensive tidiness, it is a fix for a defect
          // that made the entire product unusable with a mouse or a finger.
          // The menus live inside this element, so a pointerdown on a menu
          // button bubbles up to here; this handler then called
          // setPointerCapture on the host, which redirects every later
          // pointer event away from the button, so the matching pointerup
          // never landed on it and no click event was ever generated. Every
          // button in every sheet was dead, and it was invisible to a test
          // suite that drove the game through its own API instead of through
          // the UI. tests/menus.mjs now clicks all of them with a real mouse.
          const t = e.target;
          if (t !== target && t.tagName !== "CANVAS") return;

          target.setPointerCapture?.(e.pointerId);
          this.press("hold", "pointer", e.timeStamp);
        },
        { passive: true },
      );
      const up = (e) => {
        if (!this.enabled) return;
        this.release("hold", "pointer", e.timeStamp);
      };
      add(target, "pointerup", up, { passive: true });
      add(target, "pointercancel", up, { passive: true });
      add(target, "lostpointercapture", up, { passive: true });
      add(target, "contextmenu", (e) => e.preventDefault());
    }

    this._padPollHandle = setInterval(() => this.pollGamepads(), 16);
    this._listeners.push(() => clearInterval(this._padPollHandle));
  }

  detach() {
    for (const off of this._listeners) off();
    this._listeners.length = 0;
    this.releaseAll("detach");
  }

  press(action, source = "code", at = performance.now()) {
    const s = this._ensure(action);
    s.sources.add(source);
    if (s.down) return;
    s.down = true;
    s.pressedAt = at;
    s.pressCount++;
    s.lastPressConsumed = false;
    this._onAction?.(action, true, source, at);
  }

  release(action, source = "code", at = performance.now()) {
    const s = this._ensure(action);
    s.sources.delete(source);
    if (!s.down || s.sources.size > 0) return;
    s.down = false;
    s.releasedAt = at;
    s.releaseCount++;
    this._onAction?.(action, false, source, at);
  }

  releaseAll(reason = "all") {
    for (const name of Object.keys(this.state)) {
      const s = this.state[name];
      if (s.down) {
        s.sources.clear();
        s.down = false;
        s.releasedAt = performance.now();
        s.releaseCount++;
        this._onAction?.(name, false, reason, s.releasedAt);
      }
    }
  }

  pollGamepads() {
    if (!this.enabled || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad) continue;
      for (const [action, idxs] of Object.entries(PAD_BINDINGS)) {
        const pressed = idxs.some((i) => pad.buttons[i]?.pressed);
        const key = pad.index + ":" + action;
        if (pressed && !this._padPrev[key]) this.press(action, "pad");
        else if (!pressed && this._padPrev[key]) this.release(action, "pad");
        this._padPrev[key] = pressed;
      }
    }
  }

  /** Is the action held right now. */
  down(action) {
    return this._ensure(action).down;
  }

  /** Was it pressed within the buffer window and not yet consumed. Consuming
   *  clears it, so a buffered press is spent exactly once. */
  consumeBuffered(action, now = performance.now()) {
    const s = this._ensure(action);
    if (s.lastPressConsumed) return false;
    if (now - s.pressedAt > this.bufferMs) return false;
    s.lastPressConsumed = true;
    return true;
  }

  /** Rebind an action. Returns false and changes nothing if the code is taken
   *  by a different action, because a silently double-bound key is a bug the
   *  player experiences as the game being possessed. */
  rebind(action, codes) {
    for (const [other, list] of Object.entries(this.bindings)) {
      if (other === action) continue;
      if (codes.some((c) => list.includes(c)) && other !== "confirm" && action !== "confirm") {
        return false;
      }
    }
    this.bindings[action] = [...codes];
    return true;
  }

  resetBindings() {
    this.bindings = structuredClone(DEFAULT_BINDINGS);
  }
}
