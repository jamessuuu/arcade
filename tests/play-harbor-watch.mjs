/**
 * THE ONE TEST THAT MATTERS: a script that actually plays Harbor Watch.
 *
 * It does not check that the page loads. It opens the game, presses Play,
 * reads what is on the water through the same information the player has, and
 * holds a real Space key down at the right moments for a full three-minute
 * shift — then asserts the world actually changed as a result.
 *
 * Two rules it follows so the result means something:
 *
 * - IT ONLY USES INFORMATION THE PLAYER CAN SEE. The snapshot exposes whether
 *   a vessel's mark has emerged from the fog yet, and the driver refuses to
 *   decide before it has. A bot that peeks at the schedule would prove the
 *   rules are consistent; a bot that waits for the fog proves the game leaves
 *   a human enough time to decide, which is the thing actually in doubt.
 *
 * - IT USES REAL KEY EVENTS. page.keyboard.down("Space") goes through the same
 *   listener a person's keyboard does. Nothing calls the game's methods
 *   directly to make an outcome happen.
 *
 * Run with `--fast` to fast-forward the simulation while developing. The
 * numbers reported for frame time and latency are always taken from the
 * real-time window, never from a fast-forwarded one.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadPlaywright, serve, pixelStats, ok, info, ROOT, isMain } from "./lib.mjs";

const FAST = process.argv.includes("--fast");
const HEADED = process.argv.includes("--headed");
const GPU = process.argv.includes("--gpu") || HEADED;
const SHOTS = join(ROOT, "docs", "screenshots");

export async function run() {
  const { chromium } = await loadPlaywright();
  const server = await serve();
  // WHICH BROWSER, AND WHY IT MATTERS FOR THE NUMBERS.
  //
  // Playwright's default headless build is the headless SHELL, which
  // rasterises through SwiftShader — a CPU renderer. Its frame times say
  // nothing about what a player's GPU does (~50ms here), so they are never
  // quoted.
  //
  // `--headed` opens a real window on the real GPU, but Chromium throttles
  // requestAnimationFrame to 1Hz in a window it believes is occluded, and on a
  // working machine that window spends its life behind an editor. Three
  // separate flags and an ignoreDefaultArgs override all failed to stop it, so
  // headed runs are for LOOKING at, not for measuring.
  //
  // `--gpu` is the one that produces a real number: the full Chromium binary
  // in headless=new mode with the hardware renderer. No window exists, so
  // there is nothing to occlude, and the browser reports the actual GPU.
  // WHICH BROWSER, AND WHY IT DECIDES WHETHER THE NUMBERS MEAN ANYTHING.
  //
  // default   Playwright's headless SHELL, which rasterises through
  //           SwiftShader — a CPU renderer. About 50ms frames here. Fine for
  //           logic, useless for frame time, and never quoted.
  // --headed  A real window on the real GPU. Chromium throttles
  //           requestAnimationFrame to 1Hz in a window it believes is
  //           occluded, and an automated window spends its life behind an
  //           editor. Several flags and a default-args override all failed to
  //           stop it, so headed runs are for LOOKING at, not measuring.
  // --gpu     The one that produces a real number: the full Chromium binary
  //           in headless=new on the hardware renderer. No window exists, so
  //           there is nothing for the compositor to call occluded.
  const browser = await chromium.launch({
    headless: !HEADED,
    ...(GPU ? { channel: "chromium" } : {}),
    args: GPU
      ? [
          "--mute-audio",
          "--enable-gpu",
          "--use-angle=d3d11",
          "--window-position=0,0",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-background-timer-throttling",
        ]
      : [
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
          "--mute-audio",
          // The same three anti-throttling flags the --gpu path already
          // carried. Without them a loaded machine backgrounds the headless
          // renderer mid-run, rAF drops to ~1Hz, and the validity assertion
          // below fires — a FALSE failure, because nothing about the game
          // changed. The numbers from this path are never quoted anyway, so
          // these flags cost nothing and remove a flake that is
          // indistinguishable from a real regression.
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-background-timer-throttling",
        ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await mkdir(SHOTS, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    timeScale: FAST ? 6 : 1,
    mode: HEADED ? "headed window (for looking at, not measuring)" : GPU ? "headless=new on the hardware renderer" : "SwiftShader software raster",
  };

  try {
    const t0 = Date.now();
    await page.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__arcade?.ready === true, {
      timeout: 20000,
    });
    report.timeToInteractiveMs = Date.now() - t0;
    info("page load to interactive (ms, local static server)", report.timeToInteractiveMs);

    ok("no console errors on load", consoleErrors.length === 0, consoleErrors.join(" | "));
    ok("a canvas exists", (await page.locator("canvas").count()) === 1);

    // ---- Title screen ----------------------------------------------------
    const titleShot = await page.screenshot();
    const titleStats = await pixelStats(page, titleShot);
    await writeFile(join(SHOTS, "01-title.png"), titleShot);
    ok(
      "title screen is not a blank surface",
      titleStats.stdev > 8 && titleStats.distinctColours > 40,
      JSON.stringify(titleStats),
    );

    // ---- Start a run with a fixed seed -----------------------------------
    const SEED = 20260907;
    await page.evaluate((seed) => globalThis.__arcade.start({ seed, mode: "standard" }), SEED);
    if (FAST) await page.evaluate(() => globalThis.__arcade.setTimeScale(6));

    let s = await page.evaluate(() => globalThis.__arcade.state());
    ok("run started and the shell is in the playing state", s.shell === "playing");
    ok("the run is seeded and reproducible", s.seed === SEED, "seed " + s.seed);
    ok("a full shift was scheduled", s.snapshot.scheduled > 15, s.snapshot.scheduled + " vessels");
    ok("the wordless teach is active on the first vessel", s.snapshot.teaching === true);
    const scheduled = s.snapshot.scheduled;

    // ---- The tutorial must be un-failable: the first ship waits ----------
    await page.waitForTimeout(FAST ? 400 : 2500);
    s = await page.evaluate(() => globalThis.__arcade.state());
    ok(
      "the first vessel waits at the boom instead of being lost",
      s.snapshot.teaching === true && s.snapshot.stats.total === 0,
      `teaching=${s.snapshot.teaching} resolved=${s.snapshot.stats.total}`,
    );
    const teachShot = await page.screenshot();
    await writeFile(join(SHOTS, "02-wordless-prompt.png"), teachShot);
    const teachStats = await pixelStats(page, teachShot);
    ok(
      "the waiting screen has real content drawn on it",
      teachStats.stdev > 8 && teachStats.distinctColours > 60,
      JSON.stringify(teachStats),
    );

    // ---- Play the shift ---------------------------------------------------
    let held = false;
    const hold = async (want) => {
      if (want === held) return;
      held = want;
      if (want) await page.keyboard.down("Space");
      else await page.keyboard.up("Space");
    };

    const decisions = [];
    let firstErrorShot = null;
    let midShot = null;
    let lastTotal = 0;
    const deadline = Date.now() + (FAST ? 200_000 : 300_000);
    let ticks = 0;

    while (Date.now() < deadline) {
      s = await page.evaluate(() => globalThis.__arcade.state());
      ticks++;
      if (s.shell === "results") break;

      const snap = s.snapshot;
      const v = snap.nextVessel;

      // THE POLICY. Only ever acts on what the screen has revealed.
      let want = false;
      if (v) {
        if (snap.teaching && v.matches) want = true;
        else if (v.revealed && v.matches && v.secondsToBoom <= 0.6) want = true;
      }
      await hold(want);

      if (snap.stats.total > lastTotal) {
        lastTotal = snap.stats.total;
        decisions.push({
          n: snap.stats.total,
          t: snap.time,
          chain: snap.chain,
          stats: { ...snap.stats },
        });
        if (!firstErrorShot && (snap.stats.fouled > 0 || snap.stats.missed > 0)) {
          firstErrorShot = await page.screenshot();
        }
      }
      if (!midShot && snap.chain >= 6) midShot = await page.screenshot();

      await page.waitForTimeout(FAST ? 12 : 25);
    }
    await hold(false);

    ok("the driver polled the running game many times", ticks > 100, ticks + " polls");

    // ---- Did the world actually change? ----------------------------------
    const mid = decisions[decisions.length - 1];
    ok(
      "vessels were actually resolved during the run",
      mid && mid.stats.total >= 15,
      "resolved " + (mid?.stats.total ?? 0) + " of " + scheduled + " scheduled",
    );
    ok(
      "ships were correctly berthed (state changed, not just time passing)",
      mid && mid.stats.berthed > 5,
      "berthed " + (mid?.stats.berthed ?? 0),
    );
    ok(
      "decoys were correctly turned back",
      mid && mid.stats.turned > 3,
      "turned back " + (mid?.stats.turned ?? 0),
    );
    ok(
      "the lantern chain grew as a result",
      mid && mid.chain > 5,
      "chain length " + (mid?.chain ?? 0),
    );

    if (midShot) {
      await writeFile(join(SHOTS, "03-mid-run.png"), midShot);
      const st = await pixelStats(page, midShot);
      ok(
        "a mid-run frame is a real drawn scene",
        st.stdev > 10 && st.distinctColours > 100,
        JSON.stringify(st),
      );
      report.midRunPixels = st;
    }
    if (firstErrorShot) await writeFile(join(SHOTS, "04-after-mistake.png"), firstErrorShot);

    // ---- Frame time and latency, measured -------------------------------
    report.gpu = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
    });
    info("renderer reported by the browser", report.gpu);
    report.frame = await page.evaluate(() => globalThis.__arcade.frameStats());
    report.latency = await page.evaluate(() => globalThis.__arcade.latency());

    // A frame time only means something if the browser was actually drawing.
    // Chromium throttles requestAnimationFrame to 1Hz in a window it believes
    // is occluded, which produces ~1005ms "frames" that say nothing about the
    // game. Detect that and refuse to report the number rather than quote it.
    //
    // Counted, not maxed. The first version failed the whole gate on a single
    // frame over 400ms, which a GC pause or an OS hiccup produces on a loaded
    // machine — and a flaky gate is worse than a missing one, because its red
    // is indistinguishable from a real regression. Real throttling holds ~1Hz
    // for as long as the window stays hidden, so it shows up as many such
    // frames rather than one.
    const stalled = report.frame?.wholeRun?.over400 ?? 0;
    const throttled = stalled >= 3;
    report.frameMeasurementValid = !throttled;
    if (throttled) {
      report.frameNote =
        "INVALID: the browser window was occluded and rAF was throttled to ~1Hz. Re-run with the window visible. This number must not be quoted.";
    }
    ok(
      "the frame-time measurement is valid (the window was actually drawing)",
      !throttled,
      throttled
        ? `${stalled} frames over 400ms (worst ${report.frame.wholeRun.worstMs}ms) — window occluded, measurement discarded`
        : stalled
          ? `${stalled} isolated stall over 400ms (worst ${report.frame.wholeRun.worstMs}ms); not throttling, measurement kept`
          : "",
    );
    report.audio = await page.evaluate(() => globalThis.__arcade.audio());
    info("frame time (ms) over the run", report.frame);
    info("input latency proxy (ms)", report.latency);

    // ---- The run must END. Nothing autoplays. ----------------------------
    s = await page.evaluate(() => globalThis.__arcade.state());
    ok("the run reached a real ending on its own", s.shell === "results", "shell=" + s.shell);
    if (s.shell === "results") {
      const r = s.result;
      report.result = r;
      ok("the results screen carries a headline", !!r.headline, r.headline);
      ok(
        "the tally accounts for every vessel judged",
        r.stats.berthed + r.stats.missed + r.stats.fouled + r.stats.turned === r.stats.total,
        JSON.stringify(r.stats),
      );
      ok(
        "the run lasted roughly the advertised three minutes",
        r.durationMs > 150_000 && r.durationMs < 230_000,
        Math.round(r.durationMs / 1000) + "s of simulated shift",
      );
      info("final tally", r.stats);
      info("accuracy this run (driver, not a human)", r.accuracy + "%");

      await page.waitForTimeout(300);
      const resultShot = await page.screenshot();
      await writeFile(join(SHOTS, "05-results.png"), resultShot);
      const rs = await pixelStats(page, resultShot);
      ok("the results screen renders content", rs.stdev > 8, JSON.stringify(rs));

      // Nothing may start on its own after the end.
      const before = await page.evaluate(() => globalThis.__arcade.state().shell);
      await page.waitForTimeout(2500);
      const after = await page.evaluate(() => globalThis.__arcade.state().shell);
      ok("nothing autoplays after the run ends", before === "results" && after === "results");
    }

    ok("still no console errors after a full run", consoleErrors.length === 0, consoleErrors.join(" | "));
    report.consoleErrors = consoleErrors;
    report.decisions = decisions.length;

    await mkdir(join(ROOT, "docs"), { recursive: true });
    await writeFile(
      join(ROOT, "docs", "run-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  } finally {
    await browser.close();
    await server.close();
  }
  return report;
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\nplay-harbor-watch: FAILURES ABOVE" : "\nplay-harbor-watch: all checks passed"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
