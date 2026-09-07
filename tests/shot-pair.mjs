/**
 * Before/after evidence shots of the PORTAL, at the two viewports the
 * portfolio gate judges: 1440x900 (laptop) and 390x844 (phone).
 *
 * Usage:  node tests/shot-pair.mjs before
 *         node tests/shot-pair.mjs after
 *
 * Writes docs/screenshots/portal-<label>-<viewport>.png against the BUILT
 * site, so what is judged is what a visitor receives.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadPlaywright, serve, ROOT, isMain } from "./lib.mjs";

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "390x844", width: 390, height: 844 },
];

const PAGES = [
  { path: "/index.html", slug: "home" },
  { path: "/parents.html", slug: "parents" },
];

export async function run(label = "after") {
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const dir = join(ROOT, "docs", "screenshots");
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  try {
    for (const vp of VIEWPORTS) {
      for (const p of PAGES) {
        const page = await browser.newPage({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
        });
        await page.goto(server.origin + p.path, { waitUntil: "load" });
        await page.waitForTimeout(900);
        const file = join(dir, `portal-${label}-${p.slug}-${vp.name}.png`);
        await page.screenshot({ path: file });
        console.log("  wrote " + file);
        if (p.slug === "home") {
          const full = join(dir, `portal-${label}-${p.slug}-${vp.name}-full.png`);
          await page.screenshot({ path: full, fullPage: true });
          console.log("  wrote " + full);
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

if (isMain(import.meta.url)) {
  run(process.argv[2] || "after").catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
