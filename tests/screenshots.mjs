/**
 * Deliberate screenshots for docs/, rather than whatever frame a test happened
 * to be on. Each one is driven to a named game state first, and each is
 * checked for pixel variance — a PNG that exists is not evidence, a PNG with
 * spread is.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadPlaywright, serve, pixelStats, ok, ROOT, isMain } from "./lib.mjs";

const SHOTS = join(ROOT, "docs", "screenshots");
const HEADED = process.argv.includes("--headed");

async function shot(page, name, min = { stdev: 8, colours: 60 }) {
  const buf = await page.screenshot();
  await writeFile(join(SHOTS, name), buf);
  const st = await pixelStats(page, buf);
  ok(
    `${name} has real content`,
    st.stdev > min.stdev && st.distinctColours > min.colours,
    `stdev ${st.stdev}, ${st.distinctColours} colours`,
  );
  return st;
}

const wait = (page, fn, ms = 30000) =>
  page.waitForFunction(fn, { timeout: ms, polling: 40 });

export async function run() {
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const browser = await chromium.launch({
    headless: !HEADED,
    args: HEADED
      ? [
          "--mute-audio",
          "--window-position=0,0",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-features=CalculateNativeWinOcclusion",
        ]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  await mkdir(SHOTS, { recursive: true });

  try {
    // ---- The portal ------------------------------------------------------
    const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await desk.goto(server.origin + "/index.html", { waitUntil: "load" });
    await desk.waitForTimeout(250);
    await shot(desk, "10-portal-home.png", { stdev: 10, colours: 20 });
    await desk.goto(server.origin + "/parents.html", { waitUntil: "load" });
    await desk.waitForTimeout(350);
    await shot(desk, "11-parents.png", { stdev: 10, colours: 20 });
    await desk.close();

    const phone = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await phone.goto(server.origin + "/index.html", { waitUntil: "load" });
    await phone.waitForTimeout(250);
    await shot(phone, "12-portal-phone.png", { stdev: 10, colours: 20 });
    await phone.close();

    // ---- The game --------------------------------------------------------
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await wait(page, () => globalThis.__arcade?.ready === true);
    await page.waitForTimeout(300);
    await shot(page, "01-title.png");

    await page.evaluate(() =>
      globalThis.__arcade.start({ seed: 20260907, mode: "standard" }),
    );

    // The wordless teach: the first vessel waits, and the prompt appears.
    await wait(page, () => {
      const s = globalThis.__arcade.state().snapshot;
      return s.teaching && s.nextVessel && s.nextVessel.distanceToBoom < 230;
    });
    await page.waitForTimeout(900);
    await shot(page, "02-wordless-prompt.png");

    // Play forward to a busy stretch with a filled lantern chain.
    await page.evaluate(() => globalThis.__arcade.setTimeScale(4));
    let held = false;
    const hold = async (want) => {
      if (want === held) return;
      held = want;
      if (want) await page.keyboard.down("Space");
      else await page.keyboard.up("Space");
    };
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const s = await page.evaluate(() => globalThis.__arcade.state());
      if (s.shell !== "playing") break;
      if (s.snapshot.chain >= 9) break;
      const v = s.snapshot.nextVessel;
      await hold(
        !!v &&
          ((s.snapshot.teaching && v.matches) ||
            (v.revealed && v.matches && v.secondsToBoom <= 0.6)),
      );
      await page.waitForTimeout(14);
    }
    await hold(false);
    await page.evaluate(() => globalThis.__arcade.setTimeScale(1));

    // Hold the gate wide open with a vessel in the channel: this is the frame
    // that has to sell the verb, so it is posed rather than caught.
    await page.keyboard.down("Space");
    await page.waitForTimeout(420);
    await shot(page, "03-mid-run.png", { stdev: 10, colours: 100 });
    await page.keyboard.up("Space");

    // A refusal: gate down, vessel at the boom.
    await wait(page, () => {
      const s = globalThis.__arcade.state().snapshot;
      return s.nextVessel && s.nextVessel.distanceToBoom < 130 && s.gate < 0.1;
    }).catch(() => {});
    await shot(page, "04-gate-closed.png", { stdev: 10, colours: 100 });

    // High contrast + calm motion, to prove the settings do something visible.
    await page.evaluate(() => {
      globalThis.__arcade.setSetting("contrast", "high");
      globalThis.__arcade.setSetting("motion", "reduced");
      globalThis.__arcade.setSetting("shake", 0);
    });
    await page.waitForTimeout(300);
    await page.keyboard.down("Space");
    await page.waitForTimeout(360);
    await shot(page, "06-high-contrast.png", { stdev: 10, colours: 100 });
    await page.keyboard.up("Space");
    await page.evaluate(() => {
      globalThis.__arcade.setSetting("contrast", "normal");
      globalThis.__arcade.setSetting("motion", "auto");
      globalThis.__arcade.setSetting("shake", 0.6);
    });

    // Pause, then settings: both are shell chrome every future game inherits.
    await page.evaluate(() => globalThis.__arcade.pause());
    await page.waitForTimeout(220);
    await shot(page, "07-pause.png", { stdev: 8, colours: 40 });
    await page.click("#pauseSettingsBtn");
    await page.waitForTimeout(260);
    await shot(page, "08-settings.png", { stdev: 8, colours: 40 });
    await page.click("#closeSettings");
    await page.waitForTimeout(150);
    await page.evaluate(() => globalThis.__arcade.resume());

    // Run it to the end for the results sheet.
    await page.evaluate(() => globalThis.__arcade.setTimeScale(8));
    const t1 = Date.now();
    while (Date.now() - t1 < 120000) {
      const s = await page.evaluate(() => globalThis.__arcade.state());
      if (s.shell === "results") break;
      const v = s.snapshot?.nextVessel;
      await hold(!!v && v.revealed && v.matches && v.secondsToBoom <= 0.6);
      await page.waitForTimeout(10);
    }
    await hold(false);
    await page.waitForTimeout(500);
    await shot(page, "05-results.png", { stdev: 8, colours: 40 });

    // Phone-shaped game view, to prove the layout survives a narrow screen.
    const gphone = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await gphone.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await wait(gphone, () => globalThis.__arcade?.ready === true);
    await gphone.evaluate(() => globalThis.__arcade.start({ seed: 7, mode: "gentle" }));
    await gphone.waitForTimeout(1600);
    await shot(gphone, "13-game-phone.png", { stdev: 8, colours: 60 });
    await gphone.close();
  } finally {
    await browser.close();
    await server.close();
  }
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\nscreenshots: FAILURES ABOVE" : "\nscreenshots: ok"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
