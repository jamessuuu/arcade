/**
 * THE DARK-PATTERN GATE.
 *
 * "No dark patterns" is unfalsifiable, so the programme enumerates them and
 * this file checks the list item by item. Where a pattern can be checked at
 * RUNTIME it is checked at runtime, because a promise about behaviour should
 * be tested against behaviour: the notification check actually replaces
 * Notification.requestPermission and counts calls, and the storage check reads
 * what the game really wrote after playing it.
 *
 * The forbidden list, from the programme's section 4.4:
 *   daily-login streaks - streak-loss framing - energy or lives timers - any
 *   countdown that pressures a return - variable-ratio reward schedules, loot
 *   boxes, spin-wheels or gacha - artificial scarcity or limited-time content -
 *   "you are falling behind" comparisons - leaderboards ranking a child against
 *   strangers - autoplay-next - infinite scroll - a session with no ending -
 *   progress bars that only move when the player returns tomorrow - any reward
 *   for playing longer rather than playing well.
 *
 * Plus obligations 3, 4, 6 and 7: no ads, no purchase surface, no links out of
 * a game, and never requesting notification permission.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { loadPlaywright, serve, ok, info, ROOT, isMain } from "./lib.mjs";

/** Third-party SDKs that would each be a violation on their own. */
const BANNED_TOKENS = [
  "googletagmanager", "google-analytics", "gtag(", "googlesyndication",
  "adsbygoogle", "doubleclick", "facebook.net", "fbq(", "mixpanel",
  "amplitude", "segment.com", "posthog", "plausible", "hotjar", "sentry",
  "stripe.com", "Stripe(", "paypal", "razorpay", "adsense", "taboola",
  "outbrain", "unityads", "applovin", "admob", "firebase", "supabase",
];

/** Mechanics that would be a dark pattern if they existed in the code. */
const BANNED_MECHANICS = [
  /\bloginStreak\b/i, /\bdailyStreak\b/i, /\bstreakCount\b/i, /\bdailyBonus\b/i,
  /\bdailyReward\b/i, /\bcomeBackIn\b/i, /\benergyTimer\b/i, /\blivesRemaining\b/i,
  /\brefillAt\b/i, /\blootBox\b/i, /\bgacha\b/i, /\bspinWheel\b/i,
  /\bautoplayNext\b/i, /\bautoAdvance\b/i, /\blimitedTimeOffer\b/i,
  /\bcheckout\b/i, /\bpurchase\b/i, /\bin[-_]?app[-_]?purchase\b/i,
];

const SKIP = new Set(["node_modules", ".git", "screenshots"]);
const EXT = new Set([".html", ".js", ".mjs", ".css", ".json"]);

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (EXT.has(extname(e.name))) yield full;
  }
}

export async function run() {
  // ---- SELF-TEST: prove the patterns can match before trusting a clean run.
  const planted =
    'const loginStreak = 3; fetch("https://www.google-analytics.com/collect");';
  const caughtToken = BANNED_TOKENS.some((t) => planted.includes(t));
  const caughtMech = BANNED_MECHANICS.some((r) => r.test(planted));
  ok("the scanner catches a planted analytics call", caughtToken);
  ok("the scanner catches a planted login streak", caughtMech);

  // ---- STATIC: the shipped bundle -----------------------------------------
  const hits = [];
  for await (const file of walk(join(ROOT, "dist"))) {
    const text = await readFile(file, "utf8");
    for (const t of BANNED_TOKENS) {
      if (text.includes(t)) hits.push(`${relative(ROOT, file)}: third-party "${t}"`);
    }
    for (const r of BANNED_MECHANICS) {
      const m = text.match(r);
      if (m) hits.push(`${relative(ROOT, file)}: mechanic "${m[0]}"`);
    }
  }
  ok(
    "no ad network, analytics SDK, payment SDK or banned mechanic in the shipped bundle",
    hits.length === 0,
    hits.join(" | "),
  );

  // ---- RUNTIME ------------------------------------------------------------
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    // Count any attempt to ask for notification permission, or to register a
    // service worker (which is how a "come back tomorrow" push would arrive).
    await page.addInitScript(() => {
      globalThis.__violations = { notification: 0, serviceWorker: 0, cookieWrites: 0 };
      if (globalThis.Notification) {
        globalThis.Notification.requestPermission = () => {
          globalThis.__violations.notification++;
          return Promise.resolve("denied");
        };
      }
      if (navigator.serviceWorker) {
        const orig = navigator.serviceWorker.register.bind(navigator.serviceWorker);
        navigator.serviceWorker.register = (...a) => {
          globalThis.__violations.serviceWorker++;
          return orig(...a);
        };
      }
      const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
      Object.defineProperty(document, "cookie", {
        get: () => cookieDesc.get.call(document),
        set: (v) => {
          globalThis.__violations.cookieWrites++;
          return cookieDesc.set.call(document, v);
        },
      });
    });

    await page.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__arcade?.ready === true);

    // Play a full shift fast, so anything time-triggered has its chance.
    await page.evaluate(() => globalThis.__arcade.start({ seed: 4242, mode: "standard" }));
    await page.evaluate(() => globalThis.__arcade.setTimeScale(14));
    let held = false;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const s = await page.evaluate(() => globalThis.__arcade.state());
      if (s.shell === "results") break;
      const v = s.snapshot?.nextVessel;
      const want = !!v && ((s.snapshot.teaching && v.matches) || (v.revealed && v.matches && v.secondsToBoom <= 0.7));
      if (want !== held) {
        held = want;
        if (want) await page.keyboard.down("Space");
        else await page.keyboard.up("Space");
      }
      await page.waitForTimeout(10);
    }
    if (held) await page.keyboard.up("Space");

    const state = await page.evaluate(() => globalThis.__arcade.state());
    ok("the run reached an ending (a session that cannot end is the pattern)", state.shell === "results");

    const v = await page.evaluate(() => globalThis.__violations);
    ok("notification permission is never requested", v.notification === 0);
    ok("no service worker is registered", v.serviceWorker === 0);
    ok("no cookie is ever written", v.cookieWrites === 0);
    ok(
      "document.cookie is empty after a full run",
      (await page.evaluate(() => document.cookie)) === "",
    );

    // What did the game actually persist? Read it, do not assume it.
    const keys = await page.evaluate(() => globalThis.__arcade.storageKeys());
    const dump = await page.evaluate(() =>
      Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).map((k) => [
          k,
          localStorage.getItem(k),
        ]),
      ),
    );
    info("localStorage keys after a full run", keys);
    const blob = JSON.stringify(dump);
    const badStored = [/streak/i, /daily/i, /login/i, /energy/i, /\blives\b/i, /consecutive/i, /lastPlayed/i, /lastSeen/i];
    const storedHits = badStored.filter((r) => r.test(blob)).map(String);
    ok(
      "nothing resembling a streak, a daily counter or a return timer is stored",
      storedHits.length === 0,
      storedHits.join(" "),
    );
    ok(
      "no timestamp of when the player last played is stored",
      !/\d{13}/.test(blob),
      "a 13-digit epoch value would be a return-pressure primitive",
    );

    // ---- ZERO WORDS ON THE CANVAS (pack row G13). --------------------
    //
    // Asserted two ways, because the interesting failure is a word that
    // arrives later: a score readout, a "Level 2", a tutorial line. First,
    // PixiJS's text classes are never imported at all, so a word CANNOT be
    // drawn into the game surface. Second, the only control sitting over the
    // canvas renders a glyph and carries its words in its accessible name,
    // where a screen reader gets them and a reader of any age does not have
    // to.
    const TEXT_CLASS = [/\bnew Text\s*\(/, /\bBitmapText\b/, /\bHTMLText\b/];

    // Prove the patterns can match before believing they found nothing.
    // The first version of these three was written through a shell heredoc,
    // which collapsed the escapes: every \b arrived as a literal BACKSPACE
    // byte (0x08), so they could never match and the check reported a clean
    // pass that meant precisely nothing. `cat -A` showing `^H` caught it.
    const plantedText = ["const t = new Text({});", "new BitmapText()", "new HTMLText()"];
    ok(
      "the text-class patterns catch planted uses before being trusted",
      plantedText.every((p) => TEXT_CLASS.some((r) => r.test(p))) &&
        !TEXT_CLASS.some((r) => r.test("const g = new Graphics();")),
    );

    const srcFiles = [];
    for await (const f of walk(join(ROOT, "src"))) srcFiles.push(f);
    const textUse = [];
    for (const f of srcFiles) {
      const t = await readFile(f, "utf8");
      if (TEXT_CLASS.some((r) => r.test(t))) textUse.push(relative(ROOT, f));
    }
    ok(
      "no PixiJS text class is used anywhere, so no word can reach the canvas",
      textUse.length === 0,
      textUse.join(" "),
    );

    const padWords = await page.evaluate(() => {
      const pad = document.querySelector("#holdPad");
      return {
        visibleText: (pad?.textContent ?? "").trim(),
        accessibleName: pad?.getAttribute("aria-label") ?? "",
        canvasAriaHidden: document.querySelector("canvas")?.getAttribute("aria-hidden"),
      };
    });
    info("the hold pad", padWords);
    ok(
      "the only control over the canvas shows no word",
      padWords.visibleText === "",
      JSON.stringify(padWords.visibleText),
    );
    ok(
      "but it still has an accessible name for a screen reader",
      padWords.accessibleName.length > 4,
      padWords.accessibleName,
    );
    ok(
      "the canvas is hidden from assistive technology (the shell speaks for it)",
      padWords.canvasAriaHidden === "true",
    );

    // Obligation 6: no links out of a GAME.
    const links = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
    );
    const external = links.filter((h) => /^(https?:)?\/\//i.test(h ?? ""));
    ok("the game page contains no link that leaves the site", external.length === 0, external.join(" "));

    // Nothing may start on its own from the results screen.
    const before = (await page.evaluate(() => globalThis.__arcade.state())).shell;
    await page.waitForTimeout(4000);
    const after = (await page.evaluate(() => globalThis.__arcade.state())).shell;
    ok("the results screen does not autoplay the next run", before === "results" && after === "results");

    // A purchase surface would have to be visible somewhere.
    for (const path of ["/index.html", "/parents.html", "/harbor-watch.html"]) {
      const p2 = await browser.newPage();
      await p2.goto(server.origin + path, { waitUntil: "load" });
      const text = (await p2.evaluate(() => document.body.innerText)).toLowerCase();
      const money = ["buy", "subscribe", "upgrade", "premium", "unlock for", "$", "€", "£", "coins", "gems"];
      const found = money.filter((m) => text.includes(m));
      ok(`${path}: no purchase surface in the visible text`, found.length === 0, found.join(" "));
      await p2.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\ndark-pattern-check: FAILURES ABOVE" : "\ndark-pattern-check: clean"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
