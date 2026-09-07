/**
 * Shared test rig.
 *
 * Two deliberate choices:
 *
 * 1. The tests run against the BUILT site served by a plain static file
 *    server, not against the dev server. A dev server injects its own client
 *    and its own websocket, which would make the "zero network requests"
 *    receipt meaningless. What is measured here is what a visitor gets.
 *
 * 2. Playwright is borrowed from a sibling project rather than added as a
 *    dependency, so this repository's own dependency list stays at two
 *    packages (pixi.js, vite) and the shipped bundle has no test code in it.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLAYWRIGHT = "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DIST = join(ROOT, "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export async function loadPlaywright() {
  return import(PLAYWRIGHT);
}

/** A static server with no framework, no compression, and no surprises. */
export function serve(dir = DIST, port = 4319) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
      if (p === "" || p.endsWith("/")) p += "index.html";
      const full = join(dir, p);
      if (!full.startsWith(dir)) {
        res.writeHead(403).end("no");
        return;
      }
      const s = await stat(full).catch(() => null);
      if (!s || !s.isFile()) {
        res.writeHead(404, { "content-type": "text/plain" }).end("404");
        return;
      }
      const body = await readFile(full);
      res.writeHead(200, {
        "content-type": TYPES[extname(full)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      }),
    );
  });
}

/**
 * A screenshot of a blank canvas is a failed screenshot. This measures the
 * actual pixel spread of a PNG buffer by decoding it in a throwaway browser
 * page, so "the file exists" can never be mistaken for "something rendered".
 */
export async function pixelStats(page, buffer) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const cv = document.createElement("canvas");
    const W = (cv.width = Math.min(640, img.width));
    const H = (cv.height = Math.min(360, img.height));
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    let min = 255,
      max = 0,
      sum = 0,
      sum2 = 0,
      n = 0;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      min = Math.min(min, lum);
      max = Math.max(max, lum);
      sum += lum;
      sum2 += lum * lum;
      n++;
      if (seen.size < 5000)
        seen.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
    }
    const mean = sum / n;
    return {
      width: img.width,
      height: img.height,
      mean: +mean.toFixed(2),
      stdev: +Math.sqrt(sum2 / n - mean * mean).toFixed(2),
      min: +min.toFixed(1),
      max: +max.toFixed(1),
      distinctColours: seen.size,
    };
  }, buffer.toString("base64"));
}

export function ok(label, condition, detail = "") {
  const line = `${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`;
  console.log(line);
  if (!condition) process.exitCode = 1;
  return condition;
}

export function info(label, value) {
  console.log(`  ·   ${label}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
}

export function isMain(url) {
  return pathToFileURL(process.argv[1]).href === url;
}
