/**
 * Does the machine underneath actually do what it says?
 *
 * The play test proves a competent run produces a good result. That is only
 * half of it: a game that gave everyone a good result regardless of what they
 * pressed would also pass. So this file plays BADLY on purpose and asserts the
 * game punishes it, then checks the runtime guarantees the rest of the product
 * is built on — pause, determinism, motion settings, and the save's recovery
 * paths, including the mid-write interruption that pack row G5 asks for.
 */

import { loadPlaywright, serve, ok, info, isMain } from "./lib.mjs";

const state = (p) => p.evaluate(() => globalThis.__arcade.state());

/** Run a whole shift under a fixed policy and return the final tally. */
async function playPolicy(page, { seed, mode, policy, scale = 14 }) {
  await page.evaluate(([s, m]) => globalThis.__arcade.start({ seed: s, mode: m }), [seed, mode]);
  await page.evaluate((s) => globalThis.__arcade.setTimeScale(s), scale);
  let held = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const s = await state(page);
    if (s.shell === "results") break;
    const want = policy(s.snapshot);
    if (want !== held) {
      held = want;
      if (want) await page.keyboard.down("Space");
      else await page.keyboard.up("Space");
    }
    await page.waitForTimeout(10);
  }
  if (held) await page.keyboard.up("Space");
  const s = await state(page);
  return s.result?.stats ?? s.snapshot?.stats ?? null;
}

export async function run() {
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__arcade?.ready === true);

    // ---- The rule must actually discriminate. ---------------------------
    //
    // Note the shape of `refuseAll`: it holds for the tutorial vessel and then
    // never again. That is not the test being lenient — the first vessel WAITS
    // at the boom indefinitely until the player holds, by design, so a policy
    // that never presses anything never starts the shift at all. The first
    // version of this file used `() => false`, sat at the tutorial for ninety
    // seconds, and reported a perfectly green determinism check on two runs
    // that had both done nothing.
    const clearTeach = (snap) => snap.teaching && !!snap.nextVessel;
    const alwaysOpen = await playPolicy(page, {
      seed: 555, mode: "standard", policy: () => true,
    });
    info("holding the gate open the whole shift", alwaysOpen);
    ok(
      "letting everything through lets the wrong ships in",
      alwaysOpen.fouled > 5 && alwaysOpen.missed === 0,
      JSON.stringify(alwaysOpen),
    );

    const refuseAll = await playPolicy(page, {
      seed: 555, mode: "standard", policy: clearTeach,
    });
    info("refusing every vessel after the tutorial", refuseAll);
    ok(
      "refusing everything loses the ships that should have come in",
      refuseAll.missed > 5 && refuseAll.fouled === 0 && refuseAll.berthed === 1,
      JSON.stringify(refuseAll),
    );

    ok(
      "the same seed produces the same number of vessels under both policies",
      alwaysOpen.total === refuseAll.total,
      `${alwaysOpen.total} vs ${refuseAll.total}`,
    );
    ok(
      "and the two policies partition the same vessels exactly (the tutorial ship is let in by both)",
      alwaysOpen.berthed === refuseAll.missed + 1 && alwaysOpen.fouled === refuseAll.turned,
      `berthed ${alwaysOpen.berthed} vs missed ${refuseAll.missed}+1; fouled ${alwaysOpen.fouled} vs turned ${refuseAll.turned}`,
    );

    // ---- G1: fixed timestep means the same run at any speed. ------------
    // Same seed, no input, run to the end at two very different time scales.
    // A variable-delta loop would diverge here; this one must not.
    const slow = await playPolicy(page, { seed: 31337, mode: "gentle", policy: clearTeach, scale: 3 });
    const fast = await playPolicy(page, { seed: 31337, mode: "gentle", policy: clearTeach, scale: 16 });
    ok(
      "identical state at wildly different frame rates (fixed timestep)",
      JSON.stringify(slow) === JSON.stringify(fast) && slow.total > 8,
      `${JSON.stringify(slow)} vs ${JSON.stringify(fast)}`,
    );

    // ---- Pause must actually pause. -------------------------------------
    await page.evaluate(() => globalThis.__arcade.start({ seed: 7, mode: "standard" }));
    await page.waitForTimeout(500);
    await page.evaluate(() => globalThis.__arcade.pause());
    const a = await state(page);
    await page.waitForTimeout(1500);
    const b = await state(page);
    ok(
      "no simulation runs while paused",
      a.steps === b.steps && a.snapshot.time === b.snapshot.time,
      `steps ${a.steps} -> ${b.steps}, clock ${a.snapshot.time} -> ${b.snapshot.time}`,
    );
    await page.evaluate(() => globalThis.__arcade.resume());
    await page.waitForTimeout(600);
    const c = await state(page);
    ok("and it starts again on resume", c.steps > b.steps);

    // ---- Motion settings must be honoured at runtime, not just stored. ---
    await page.evaluate(() => {
      globalThis.__arcade.setSetting("motion", "full");
      globalThis.__arcade.setSetting("shake", 1);
    });
    // Peak displacement is tracked INSIDE the page and read once, rather than
    // polled across the process boundary: trauma decays in about a quarter of
    // a second, so an outside sampler lands in the gaps between events and
    // reports a number that depends on how loaded the machine is.
    const shakeRun = async (ms) => {
      await page.evaluate(() => globalThis.__arcade.resetMotionPeak());
      await page.keyboard.down("Space");
      await page.waitForTimeout(ms);
      await page.keyboard.up("Space");
      return page.evaluate(() => globalThis.__arcade.motion());
    };

    await page.evaluate(() => globalThis.__arcade.setTimeScale(8));
    const shaken = await shakeRun(5000);
    info("peak camera displacement with shake at 100%", shaken.peakOffset + "px");
    ok(
      "with shake at full, a mistake actually moves the camera",
      shaken.shakeScale === 1 && shaken.peakOffset > 2,
      JSON.stringify(shaken),
    );

    await page.evaluate(() => globalThis.__arcade.setSetting("shake", 0));
    const still = await shakeRun(5000);
    info("peak camera displacement with shake at 0%", still.peakOffset + "px");
    ok(
      "with shake at zero the camera does not move at all, even on a mistake",
      still.shakeScale === 0 && still.peakOffset === 0 && still.trauma === 0,
      JSON.stringify(still),
    );

    await page.evaluate(() => globalThis.__arcade.setSetting("motion", "reduced"));
    const reduced = await page.evaluate(() => globalThis.__arcade.motion());
    ok(
      "calm movement forces shake off regardless of the slider",
      reduced.reduced === true && reduced.shakeScale === 0 && reduced.flashAllowed === false,
      JSON.stringify(reduced),
    );

    // The OS-level preference must win on its own, with no setting touched.
    const rm = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await rm.emulateMedia({ reducedMotion: "reduce" });
    await rm.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await rm.waitForFunction(() => globalThis.__arcade?.ready === true);
    await rm.evaluate(() => globalThis.__arcade.setSetting("motion", "auto"));
    const osLevel = await rm.evaluate(() => globalThis.__arcade.motion());
    ok(
      "a device set to reduce motion is obeyed with no setting changed",
      osLevel.reduced === true && osLevel.shakeScale === 0,
      JSON.stringify(osLevel),
    );
    await rm.close();

    // ---- Save: the three recovery paths (pack row G5). ------------------
    const recover = async (setup, expected) => {
      const p = await browser.newPage();
      await p.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
      await p.evaluate(setup);
      await p.reload({ waitUntil: "load" });
      await p.waitForFunction(() => globalThis.__arcade?.ready === true);
      const reason = await p.evaluate(() => globalThis.__arcade.saveRecovery());
      const settings = await p.evaluate(() => globalThis.__arcade.settings());
      ok(
        `a ${expected} save is recovered from rather than crashing`,
        reason === expected && settings.volumeMaster === 0.8,
        `reason=${reason}`,
      );
      await p.close();
    };
    await recover(() => localStorage.setItem("arcade.save.v1", "{ not json at all"), "unparseable");
    await recover(() => localStorage.setItem("arcade.save.v1", JSON.stringify({ hello: 1 })), "wrong-shape");
    await recover(() => {
      localStorage.setItem("arcade.save.v1", JSON.stringify({ version: 1, settings: {}, games: {} }));
      localStorage.setItem("arcade.save.v1.staging", '{"half":');
    }, "interrupted-write");
    await recover(
      () => localStorage.setItem("arcade.save.v1", JSON.stringify({ version: 99, settings: {}, games: {} })),
      "from-newer-build",
    );

    // ---- The parents page's erase button has to actually erase. ---------
    const pp = await browser.newPage();
    await pp.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await pp.waitForFunction(() => globalThis.__arcade?.ready === true);
    await pp.evaluate(() => globalThis.__arcade.setSetting("volumeMaster", 0.25));
    await pp.goto(server.origin + "/parents.html", { waitUntil: "load" });
    const beforeKeys = await pp.evaluate(() => localStorage.length);
    ok("the parents page has something to erase after playing", beforeKeys > 0, beforeKeys + " keys");
    await pp.evaluate(() => {
      const a = Number(document.querySelector("#gateA").textContent);
      const b = Number(document.querySelector("#gateB").textContent);
      document.querySelector("#gateAnswer").value = String(a * b);
      document.querySelector("#gateSubmit").click();
    });
    await pp.waitForTimeout(150);
    ok("a wrong answer keeps the erase button hidden", await pp.evaluate(() => !document.querySelector("#eraseArea").hidden));
    await pp.click("#eraseBtn");
    await pp.waitForTimeout(300);
    const afterKeys = await pp.evaluate(() => localStorage.length);
    const shown = await pp.evaluate(() => document.querySelector("#storageDump").textContent);
    ok("erase removes every stored value", afterKeys === 0, afterKeys + " keys left");
    ok("and the page redisplays the now-empty storage", /Nothing\./.test(shown), shown.slice(0, 60));
    await pp.close();
  } finally {
    await browser.close();
    await server.close();
  }
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\nmechanics: FAILURES ABOVE" : "\nmechanics: all checks passed"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
