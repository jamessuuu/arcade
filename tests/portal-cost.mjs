/**
 * WHAT THE PORTAL'S MOTION ACTUALLY COSTS.
 *
 * The programme's rule is that an effect is measured, not assumed. Three
 * effects were measured on another project the same week and rejected there:
 *
 *     gaussian blur on a shadow layer    58   -> 24    fps
 *     mix-blend-mode: overlay            60   -> 47.8  fps
 *     backdrop-filter on small chips     60   -> 44.7  fps
 *
 * None of the three is used here, so this file measures what IS used: an SVG
 * hero scene animating `transform` and `opacity` only, plus one static radial
 * wash on the body. It compares the page against itself with motion switched
 * off (the reduced-motion path), which is the only comparison that isolates
 * the animation from the cost of painting the page at all.
 *
 * Run:  node tests/portal-cost.mjs
 */

import { loadPlaywright, serve, ok, info, isMain } from "./lib.mjs";

const SAMPLE_MS = 5000;

const MEASURE = (ms) =>
  new Promise((resolve) => {
    const frames = [];
    let last = performance.now();
    const t0 = last;
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      if (now - t0 < ms) requestAnimationFrame(tick);
      else {
        const sorted = frames.slice(1).sort((a, b) => a - b);
        const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
        resolve({
          frames: sorted.length,
          fps: +(1000 / at(0.5)).toFixed(1),
          p50: +at(0.5).toFixed(2),
          p95: +at(0.95).toFixed(2),
          worst: +sorted[sorted.length - 1].toFixed(2),
          over16_7: sorted.filter((f) => f > 16.7).length,
        });
      }
    };
    requestAnimationFrame(tick);
  });

export async function run() {
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const results = {};
  try {
    for (const [label, reduce] of [
      ["motion on", "no-preference"],
      ["motion off", "reduce"],
    ]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.emulateMedia({ reducedMotion: reduce });
      await page.goto(server.origin + "/index.html", { waitUntil: "load" });
      await page.waitForTimeout(1200);
      results[label] = await page.evaluate(MEASURE, SAMPLE_MS);
      info(`portal, ${label}`, JSON.stringify(results[label]));
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const on = results["motion on"];
  const off = results["motion off"];
  const delta = +(on.p50 - off.p50).toFixed(2);
  info("cost of the hero animation (p50 frame time)", `${delta} ms`);

  // A compositor-only animation should be free within noise. One frame budget
  // at 60Hz is 16.7ms; a whole millisecond of the budget is already generous
  // for what is, in the end, a lamp that breathes.
  ok(
    "the animated hero costs less than 1ms of the frame budget",
    delta < 1,
    `${delta} ms (motion on p50 ${on.p50}ms, motion off p50 ${off.p50}ms)`,
  );
  ok(
    "and the portal still holds a 60Hz frame with motion on",
    on.p50 <= 17.5,
    `p50 ${on.p50}ms, p95 ${on.p95}ms, worst ${on.worst}ms`,
  );
  return results;
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\nportal-cost: OVER BUDGET" : "\nportal-cost: inside budget"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
