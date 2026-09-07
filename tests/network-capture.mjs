/**
 * THE RECEIPT.
 *
 * The whole product rests on one sentence: nothing leaves your device. That is
 * a claim a parent can check, which is rare in this market, and it is only
 * worth making because it can be checked.
 *
 * This records EVERY request the browser makes across all three pages plus a
 * complete played run of the game, splits them into "loading the page" and
 * "after the page was loaded", and writes the whole log to
 * docs/network-capture.json so anyone can compare it against their own
 * devtools rather than take our word for it.
 *
 * The bar is strict: after load, zero requests of any kind. During load, zero
 * requests to any origin other than the page's own.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadPlaywright, serve, ok, info, ROOT, isMain } from "./lib.mjs";

export async function run() {
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const capture = {
    recordedAt: new Date().toISOString(),
    origin: server.origin,
    note:
      "Every request the browser made. 'phase' is loading while the page is still coming up, and playing from the moment the game was started. The claim on the parents page is that the playing phase is empty.",
    pages: {},
  };

  try {
    for (const path of ["/index.html", "/parents.html", "/harbor-watch.html"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const requests = [];
      let phase = "loading";
      page.on("request", (r) => {
        requests.push({ phase, method: r.method(), url: r.url(), type: r.resourceType() });
      });
      // A failed request still counts as an attempt to reach out.
      page.on("requestfailed", (r) =>
        requests.push({ phase, method: r.method(), url: r.url(), type: "FAILED" }),
      );

      await page.goto(server.origin + path, { waitUntil: "networkidle" });

      if (path === "/harbor-watch.html") {
        await page.waitForFunction(() => globalThis.__arcade?.ready === true);
        phase = "playing";
        await page.evaluate(() => globalThis.__arcade.start({ seed: 99, mode: "standard" }));
        await page.evaluate(() => globalThis.__arcade.setTimeScale(14));

        // Play it properly: hold, release, make mistakes, open menus, change
        // settings, finish. Anything that would phone home gets its chance.
        let held = false;
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
          const s = await page.evaluate(() => globalThis.__arcade.state());
          if (s.shell === "results") break;
          const v = s.snapshot?.nextVessel;
          const want =
            !!v &&
            ((s.snapshot.teaching && v.matches) ||
              (v.revealed && v.matches && v.secondsToBoom <= 0.7));
          if (want !== held) {
            held = want;
            if (want) await page.keyboard.down("Space");
            else await page.keyboard.up("Space");
          }
          await page.waitForTimeout(10);
        }
        if (held) await page.keyboard.up("Space");
        await page.evaluate(() => {
          globalThis.__arcade.setSetting("contrast", "high");
          globalThis.__arcade.setSetting("volumeMaster", 0.3);
        });
        await page.waitForTimeout(1200);
      } else {
        // Exercise the parents page's live storage read and its erase button.
        if (path === "/parents.html") {
          await page.evaluate(() => {
            const g = document.querySelector("#gateAnswer");
            const a = Number(document.querySelector("#gateA").textContent);
            const b = Number(document.querySelector("#gateB").textContent);
            g.value = String(a * b);
            document.querySelector("#gateSubmit").click();
          });
          await page.waitForTimeout(200);
          await page.click("#eraseBtn");
          await page.waitForTimeout(600);
        }
        await page.waitForTimeout(1500);
      }

      capture.pages[path] = requests;
      const own = new URL(server.origin).host;
      const foreign = requests.filter((r) => {
        try {
          return new URL(r.url).host !== own;
        } catch {
          return !r.url.startsWith("data:") && !r.url.startsWith("blob:");
        }
      });
      const afterLoad = requests.filter((r) => r.phase === "playing");

      info(`${path} requests during load`, requests.filter((r) => r.phase === "loading").length);
      ok(`${path}: every request goes to this site and nowhere else`, foreign.length === 0, foreign.map((f) => f.url).join(" "));
      ok(`${path}: zero requests after the page finished loading`, afterLoad.length === 0, afterLoad.map((f) => f.url).join(" "));

      await page.close();
    }

    await mkdir(join(ROOT, "docs"), { recursive: true });
    await writeFile(
      join(ROOT, "docs", "network-capture.json"),
      JSON.stringify(capture, null, 2) + "\n",
    );
    const total = Object.values(capture.pages).reduce((a, r) => a + r.length, 0);
    info("total requests recorded across all three pages", total);
    console.log("  ·   written to docs/network-capture.json");
  } finally {
    await browser.close();
    await server.close();
  }
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\nnetwork-capture: FAILURES ABOVE" : "\nnetwork-capture: nothing left the device"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
