/**
 * The house save.
 *
 * There is exactly one place this data can be: localStorage, on this device.
 * No account, no sync, no server, no cookie. That is not a limitation we are
 * working around — it is the design decision the whole product is built on,
 * and the parents page states it in those words.
 *
 * Two things make this more than a JSON.stringify wrapper, and both exist
 * because pack row G5 asks for them:
 *
 * 1. VERSIONING WITH MIGRATION. Shape changes are inevitable across twenty
 *    games. A save written by v1 must still open in v3 or the player loses
 *    their harbour, so every version bump ships a migration and the migrations
 *    run in order.
 *
 * 2. A MID-WRITE INTERRUPTION RECOVERY PATH. A tab killed between "clear" and
 *    "write" is a real thing that happens on phones. We write to a staging key
 *    first and only then commit. If staging is still present at load time, the
 *    last write did not finish: we discard the half-written staging copy and
 *    open the last good commit. If the committed copy is itself unreadable, it
 *    is quarantined under a `.broken` key (so it can be inspected rather than
 *    silently destroyed) and the player starts clean instead of meeting a
 *    white screen.
 */

const KEY = "arcade.save.v1";
const STAGING = "arcade.save.v1.staging";
const BROKEN = "arcade.save.v1.broken";
export const SAVE_VERSION = 1;

function defaults() {
  return {
    version: SAVE_VERSION,
    settings: {
      theme: "system",
      contrast: "normal",
      motion: "auto", // auto | reduced | full
      shake: 0.6, // 0..1, 0 is off
      flash: true, // screen-wide brightness pops
      volumeMaster: 0.8,
      volumeEffects: 1,
      volumeAmbience: 0.7,
      mode: "standard",
    },
    games: {},
  };
}

/** Ordered migrations. migrations[n] takes a v(n) save and returns v(n+1). */
const migrations = [
  // migrations[0] would take a v0 save to v1. There has never been a v0.
];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** A save that parses but is not shaped like a save is still a corrupt save. */
function validate(data) {
  if (!isPlainObject(data)) return false;
  if (typeof data.version !== "number") return false;
  if (!isPlainObject(data.settings)) return false;
  if (!isPlainObject(data.games)) return false;
  return true;
}

export class Save {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    /** Set when the last load had to recover. The results screen never shows
     *  this; the settings panel does, because a player deserves to be told
     *  their progress was reset rather than left to wonder. */
    this.lastRecovery = null;
    this.data = this._load();
  }

  _read(key) {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null; // Private mode, disabled storage, quota. Play anyway.
    }
  }

  _write(key, value) {
    try {
      this.storage?.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  _remove(key) {
    try {
      this.storage?.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  _load() {
    // 1. An orphaned staging record means the last write was interrupted.
    const staging = this._read(STAGING);
    if (staging !== null) {
      this._remove(STAGING);
      this.lastRecovery = "interrupted-write";
    }

    const raw = this._read(KEY);
    if (raw === null) return defaults();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this._write(BROKEN, raw);
      this._remove(KEY);
      this.lastRecovery = "unparseable";
      return defaults();
    }

    if (!validate(parsed)) {
      this._write(BROKEN, raw);
      this._remove(KEY);
      this.lastRecovery = "wrong-shape";
      return defaults();
    }

    // 2. Migrate forward, in order.
    let data = parsed;
    while (data.version < SAVE_VERSION) {
      const migrate = migrations[data.version];
      if (!migrate) {
        this._write(BROKEN, raw);
        this._remove(KEY);
        this.lastRecovery = "no-migration";
        return defaults();
      }
      data = migrate(data);
      data.version += 1;
    }
    // A save from the future (the player opened a newer build first) is not
    // corrupt, but we must not pretend to understand it.
    if (data.version > SAVE_VERSION) {
      this.lastRecovery = "from-newer-build";
      return defaults();
    }

    const merged = defaults();
    merged.settings = { ...merged.settings, ...data.settings };
    merged.games = { ...data.games };
    return merged;
  }

  /** Staging-then-commit. The window in which a kill leaves inconsistent state
   *  is the single setItem that writes KEY, which localStorage performs
   *  atomically per key. */
  flush() {
    const payload = JSON.stringify(this.data);
    if (!this._write(STAGING, payload)) return false;
    const ok = this._write(KEY, payload);
    this._remove(STAGING);
    return ok;
  }

  get settings() {
    return this.data.settings;
  }

  /** Per-game record, created on first touch. */
  game(id) {
    if (!this.data.games[id]) this.data.games[id] = {};
    return this.data.games[id];
  }

  set(path, value) {
    const parts = path.split(".");
    let node = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!isPlainObject(node[parts[i]])) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
    this.flush();
    return value;
  }

  /** The button on the parents page. Erases everything this site has ever
   *  stored, including the quarantine copy. Tested; not decorative. */
  eraseEverything() {
    this._remove(KEY);
    this._remove(STAGING);
    this._remove(BROKEN);
    this.data = defaults();
    this.lastRecovery = null;
    return true;
  }

  /** What is actually on this device, for the parents page to print. */
  inventory() {
    const keys = [];
    try {
      for (let i = 0; i < (this.storage?.length ?? 0); i++) {
        const k = this.storage.key(i);
        if (k) keys.push(k);
      }
    } catch {
      /* ignore */
    }
    return keys;
  }
}
