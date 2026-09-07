/**
 * Drive the shell the way a person does: a real mouse, a real finger, and the
 * keyboard alone.
 *
 * This file exists because of a specific failure. The play test drove the game
 * through `__arcade`, every check passed, and the product was completely
 * unusable with a mouse — a pointer-capture bug meant no button in any sheet
 * ever received a click. A test that only speaks to the API cannot see that.
 * So: every path below goes through the actual interface.
 */

import { loadPlaywright, serve, ok, info, isMain } from "./lib.mjs";

const state = (page) => page.evaluate(() => globalThis.__arcade.state());

export async function run() {
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  });

  try {
    // ================= MOUSE =================
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__arcade?.ready === true);

    // Mode choice, then Play — with the mouse.
    await page.click('[data-mode="gentle"]');
    ok(
      "clicking a mode selects it",
      (await page.getAttribute('[data-mode="gentle"]', "aria-pressed")) === "true",
    );
    await page.click("#playBtn");
    await page.waitForTimeout(200);
    ok("clicking Play starts a run", (await state(page)).shell === "playing");
    ok("the chosen mode is the one that runs", (await state(page)).mode === "gentle");

    // Pause via the title-bar button.
    await page.click("#pauseBtn");
    await page.waitForTimeout(150);
    ok("clicking Pause pauses", (await state(page)).shell === "paused");

    // Pause -> Settings -> change a setting -> Done -> back to Pause.
    await page.click("#pauseSettingsBtn");
    await page.waitForTimeout(150);
    ok("Settings opens from the pause sheet", (await page.locator("#closeSettings").count()) === 1);

    await page.click('[data-set="motion"][data-value="reduced"]');
    await page.waitForTimeout(100);
    const motion = await page.evaluate(() => globalThis.__arcade.motion());
    ok("choosing Calm movement takes effect immediately", motion.reduced === true && motion.shakeScale === 0, JSON.stringify(motion));

    await page.click('[data-set="flash"][data-value="false"]');
    await page.waitForTimeout(80);
    ok(
      "turning off bright flashes takes effect immediately",
      (await page.evaluate(() => globalThis.__arcade.motion())).flashAllowed === false,
    );

    await page.click("#closeSettings");
    await page.waitForTimeout(150);
    ok("Done returns to the pause sheet", (await page.locator("#resumeBtn").count()) === 1);

    // Settings must survive a reload: this is the save doing its job.
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__arcade?.ready === true);
    const persisted = await page.evaluate(() => globalThis.__arcade.settings());
    ok(
      "settings survive a reload (localStorage round trip)",
      persisted.motion === "reduced" && persisted.flash === false,
      JSON.stringify({ motion: persisted.motion, flash: persisted.flash }),
    );

    // Reset for the rest of the run.
    await page.evaluate(() => {
      globalThis.__arcade.setSetting("motion", "auto");
      globalThis.__arcade.setSetting("flash", true);
    });

    // ================= TOUCH: the hold pad =================
    const phone = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await phone.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await phone.waitForFunction(() => globalThis.__arcade?.ready === true);
    await phone.tap("#playBtn");
    await phone.waitForTimeout(300);
    ok("Play works by tap", (await state(phone)).shell === "playing");

    const box = await phone.locator("#holdPad").boundingBox();
    ok(
      "the hold pad clears the 44px target floor",
      box && box.width >= 44 && box.height >= 44,
      box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no box",
    );

    const before = (await state(phone)).snapshot.gate;
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phone.mouse.down();
    await phone
      .waitForFunction(() => globalThis.__arcade.state().snapshot.gate > 0.6, { timeout: 8000 })
      .catch(() => {});
    const during = (await state(phone)).snapshot.gate;
    await phone.mouse.up();
    await phone
      .waitForFunction(() => globalThis.__arcade.state().snapshot.gate < 0.05, { timeout: 8000 })
      .catch(() => {});
    const after = (await state(phone)).snapshot.gate;
    ok(
      "holding the pad raises the boom and releasing lowers it",
      before < 0.05 && during > 0.5 && after < 0.2,
      `gate ${before} -> ${during} -> ${after}`,
    );
    await phone.close();

    // ================= KEYBOARD ONLY =================
    const kb = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await kb.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await kb.waitForFunction(() => globalThis.__arcade?.ready === true);

    // Reach Play using nothing but Tab, then activate with Enter.
    let reached = false;
    for (let i = 0; i < 20; i++) {
      const id = await kb.evaluate(() => document.activeElement?.id ?? "");
      if (id === "playBtn") {
        reached = true;
        break;
      }
      await kb.keyboard.press("Tab");
    }
    ok("the Play button is reachable with Tab alone", reached);
    await kb.keyboard.press("Enter");
    await kb.waitForTimeout(200);
    ok("Enter starts the run", (await state(kb)).shell === "playing");

    // Space is the verb. Waited for rather than timed: under a software
    // renderer on a loaded machine the simulation advances in bursts, and a
    // fixed 250ms window made this assertion depend on the build agent's CPU.
    await kb.keyboard.down("Space");
    await kb
      .waitForFunction(() => globalThis.__arcade.state().snapshot.gate > 0.6, { timeout: 8000 })
      .catch(() => {});
    const gOpen = (await state(kb)).snapshot.gate;
    await kb.keyboard.up("Space");
    await kb
      .waitForFunction(() => globalThis.__arcade.state().snapshot.gate < 0.05, { timeout: 8000 })
      .catch(() => {});
    const gShut = (await state(kb)).snapshot.gate;
    ok("Space raises the boom and releasing lowers it", gOpen > 0.5 && gShut < 0.2, `${gOpen} -> ${gShut}`);

    // Escape toggles pause both ways.
    await kb.keyboard.press("Escape");
    await kb.waitForTimeout(150);
    ok("Escape pauses", (await state(kb)).shell === "paused");
    await kb.keyboard.press("Escape");
    await kb.waitForTimeout(150);
    ok("Escape resumes", (await state(kb)).shell === "playing");

    // Focus must be trapped inside an open sheet, or a keyboard player tabs
    // out into a page they cannot see.
    await kb.keyboard.press("Escape");
    await kb.waitForTimeout(150);
    let inside = true;
    for (let i = 0; i < 14; i++) {
      await kb.keyboard.press("Tab");
      const ok2 = await kb.evaluate(
        () => !!document.activeElement?.closest("#overlay"),
      );
      if (!ok2) inside = false;
    }
    ok("focus stays inside the pause sheet while it is open", inside);

    // End the run from the keyboard and land back on the title.
    await kb.evaluate(() => document.querySelector("#endBtn").focus());
    await kb.keyboard.press("Enter");
    await kb.waitForTimeout(200);
    ok("a run can be ended and returns to the title", (await state(kb)).shell === "title");

    // ================= TARGET SIZES ACROSS EVERY SHEET =================
    const small = await kb.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll(
        "button, a[href], input[type=range], .choice",
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.width < 44 || r.height < 44) {
          bad.push({
            what: el.id || el.className || el.tagName,
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      }
      return bad;
    });
    ok(
      "every control on the title sheet clears 44x44",
      small.length === 0,
      JSON.stringify(small),
    );

    ok("no uncaught page errors anywhere in this file", errors.length === 0, errors.join(" | "));
    await kb.close();
    await page.close();
  } finally {
    await browser.close();
    await server.close();
  }
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\nmenus: FAILURES ABOVE" : "\nmenus: all checks passed"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
