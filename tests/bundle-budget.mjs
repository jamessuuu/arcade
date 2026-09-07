/**
 * Measured payload, not estimated payload.
 *
 * The programme's first-load bar is 2MB or under for the initial payload and a
 * first interactive frame under 3s on a throttled profile. Nothing here is
 * quoted from a build log summary: every byte is counted by loading the real
 * page from a real server and adding up what the browser actually pulled, and
 * the gzip figure is produced by gzipping the real files.
 */

import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { loadPlaywright, serve, ok, info, ROOT, DIST, isMain } from "./lib.mjs";

const BUDGET_BYTES = 2 * 1024 * 1024;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

export async function run() {
  // ---- What is on disk ---------------------------------------------------
  let raw = 0;
  let gz = 0;
  const files = [];
  for await (const f of walk(DIST)) {
    const buf = await readFile(f);
    const g = gzipSync(buf).length;
    raw += buf.length;
    gz += g;
    files.push({ file: relative(DIST, f), bytes: buf.length, gzip: g });
  }
  files.sort((a, b) => b.bytes - a.bytes);
  console.log("  ·   built site, largest first:");
  for (const f of files.slice(0, 8)) {
    console.log(
      `        ${f.file.padEnd(38)} ${String(f.bytes).padStart(8)} B   ${String(f.gzip).padStart(7)} B gzip`,
    );
  }
  info("whole site on disk", `${(raw / 1024).toFixed(1)} kB raw, ${(gz / 1024).toFixed(1)} kB gzip, ${files.length} files`);

  // ---- What a visitor actually downloads per page ------------------------
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const report = { measuredAt: new Date().toISOString(), budgetBytes: BUDGET_BYTES, pages: {} };

  try {
    for (const path of ["/index.html", "/parents.html", "/harbor-watch.html"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      let bytes = 0;
      let gzipEstimate = 0;
      const seen = [];
      page.on("response", async (res) => {
        try {
          const body = await res.body();
          bytes += body.length;
          gzipEstimate += gzipSync(body).length;
          seen.push({ url: res.url().split("/").pop(), bytes: body.length });
        } catch {
          /* redirect or no body */
        }
      });

      const t0 = Date.now();
      await page.goto(server.origin + path, { waitUntil: "load" });
      const loadMs = Date.now() - t0;

      let interactiveMs = loadMs;
      if (path === "/harbor-watch.html") {
        await page.waitForFunction(() => globalThis.__arcade?.ready === true, { timeout: 20000 });
        interactiveMs = Date.now() - t0;
      }
      await page.waitForTimeout(500);

      report.pages[path] = {
        transferredBytes: bytes,
        gzipEquivalentBytes: gzipEstimate,
        requests: seen.length,
        loadMs,
        interactiveMs,
      };
      info(
        path,
        `${(bytes / 1024).toFixed(1)} kB uncompressed / ${(gzipEstimate / 1024).toFixed(1)} kB gzip over ${seen.length} requests; interactive at ${interactiveMs}ms (local server, software renderer)`,
      );
      ok(
        `${path}: initial payload is inside the 2MB budget`,
        bytes <= BUDGET_BYTES,
        `${(bytes / 1024 / 1024).toFixed(3)} MB`,
      );
      await page.close();
    }

    // A page with no JS at all should still be a readable page.
    const nojs = await browser.newPage({ javaScriptEnabled: false });
    await nojs.goto(server.origin + "/index.html", { waitUntil: "load" });
    const text = await nojs.evaluate(() => document.body.innerText.length).catch(() => 0);
    ok("the portal still reads with JavaScript switched off", text > 400, text + " characters");
    await nojs.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    const noscript = await nojs.content();
    ok(
      "the game page explains itself with JavaScript switched off",
      /needs JavaScript/i.test(noscript),
    );
    await nojs.close();

    await mkdir(join(ROOT, "docs"), { recursive: true });
    await writeFile(
      join(ROOT, "docs", "bundle-report.json"),
      JSON.stringify({ ...report, disk: { rawBytes: raw, gzipBytes: gz, files } }, null, 2) + "\n",
    );
    console.log("  ·   written to docs/bundle-report.json");
  } finally {
    await browser.close();
    await server.close();
  }
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\nbundle-budget: FAILURES ABOVE" : "\nbundle-budget: inside budget"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
