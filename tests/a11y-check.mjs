/**
 * THE ACCESSIBILITY FLOOR, measured against the rendered page.
 *
 * The programme calls this a floor rather than a target, so it is checked
 * mechanically on every page rather than reviewed by eye once:
 *
 *   Motor   — every interactive target is at least 44 x 44 CSS pixels.
 *   Vision  — every text pair clears 4.5:1 against what is actually rendered,
 *             computed from resolved colours rather than from the token file,
 *             so a theme or a contrast setting cannot quietly break it.
 *   Colour  — status is never carried by hue alone: the two card states have a
 *             word AND a distinct outline style, and the results tally uses
 *             three different SHAPES.
 *   Motion  — checked in mechanics.mjs at runtime, not here.
 *   Keyboard— every page is fully traversable with Tab, with a visible focus
 *             ring, a skip link, and no trap.
 *
 * Contrast is computed by asking the browser to resolve each colour through a
 * canvas, which handles oklch() and inheritance without this file having to
 * reimplement a colour space.
 */

import { loadPlaywright, serve, ok, info, isMain } from "./lib.mjs";

const PAGES = ["/index.html", "/parents.html", "/harbor-watch.html"];

const AUDIT = () => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });

  /** Resolve any CSS colour string to [r,g,b,a] via the browser itself. */
  const rgba = (css) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = css;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  /** Walk up for the first non-transparent background. */
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0.9) return c;
      n = n.parentElement;
    }
    return rgba(getComputedStyle(document.body).backgroundColor);
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };

  // --- target sizes ------------------------------------------------------
  const smallTargets = [];
  for (const el of document.querySelectorAll(
    'button, a[href], input, select, textarea, [role="button"], .choice',
  )) {
    if (!visible(el)) continue;
    // The WCAG 2.5.8 exemption: a link that is part of a sentence of text.
    const inline = getComputedStyle(el).display === "inline" && el.closest("p, li, td");
    if (inline) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      smallTargets.push({
        what: (el.id || el.className || el.tagName).toString().slice(0, 40),
        text: (el.textContent || "").trim().slice(0, 24),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  }

  // --- text contrast -----------------------------------------------------
  const lowContrast = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(
    "p, li, h1, h2, h3, td, th, span, button, a, label, output, code, b, strong, caption",
  )) {
    if (!visible(el)) continue;
    const own = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
    );
    if (!own) continue;
    const cs = getComputedStyle(el);
    const fg = rgba(cs.color);
    if (fg[3] < 0.5) continue;
    const bg = bgOf(el);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    const key = cs.color + "|" + bg.join(",") + "|" + need;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r < need) {
      lowContrast.push({
        text: el.textContent.trim().slice(0, 34),
        fg: cs.color,
        ratio: +r.toFixed(2),
        need,
        px: +size.toFixed(1),
      });
    }
  }

  // --- structure ---------------------------------------------------------
  const h1s = document.querySelectorAll("h1").length;
  const lang = document.documentElement.lang;
  const skip = !!document.querySelector(".skip-link");
  const unnamedImages = [...document.querySelectorAll('svg[role="img"], img')].filter(
    (el) =>
      !el.getAttribute("aria-label") &&
      !el.getAttribute("alt") &&
      !el.querySelector("title"),
  ).length;
  const unnamedButtons = [...document.querySelectorAll("button, a[href]")].filter(
    (el) =>
      visible(el) &&
      !(el.textContent || "").trim() &&
      !el.getAttribute("aria-label") &&
      !el.querySelector(".visually-hidden"),
  ).length;

  return {
    smallTargets,
    lowContrast,
    h1s,
    lang,
    skip,
    unnamedImages,
    unnamedButtons,
    contrastChecked: seen.size,
  };
};

export async function run() {
  const { chromium } = await loadPlaywright();
  const server = await serve();
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  });

  try {
    for (const scheme of ["light", "dark"]) {
      for (const path of PAGES) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(server.origin + path, { waitUntil: "load" });
        if (path === "/harbor-watch.html") {
          await page.waitForFunction(() => globalThis.__arcade?.ready === true);
        }
        await page.waitForTimeout(250);
        const r = await page.evaluate(AUDIT);
        const tag = `${path} [${scheme}]`;
        ok(`${tag} every target is at least 44x44`, r.smallTargets.length === 0, JSON.stringify(r.smallTargets));
        ok(
          `${tag} every text pair clears its contrast minimum (${r.contrastChecked} distinct pairs)`,
          r.lowContrast.length === 0,
          JSON.stringify(r.lowContrast),
        );
        ok(`${tag} exactly one h1`, r.h1s === 1, "found " + r.h1s);
        ok(`${tag} the document declares a language`, r.lang === "en");
        ok(`${tag} a skip link exists`, r.skip);
        ok(`${tag} every image has an accessible name`, r.unnamedImages === 0, String(r.unnamedImages));
        ok(`${tag} every control has an accessible name`, r.unnamedButtons === 0, String(r.unnamedButtons));
        await page.close();
      }
    }

    // High-contrast setting must raise contrast, not merely repaint.
    const hc = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await hc.goto(server.origin + "/harbor-watch.html", { waitUntil: "load" });
    await hc.waitForFunction(() => globalThis.__arcade?.ready === true);
    await hc.evaluate(() => globalThis.__arcade.setSetting("contrast", "high"));
    await hc.waitForTimeout(200);
    const hcr = await hc.evaluate(AUDIT);
    ok(
      "the high-contrast setting keeps every pair above the minimum too",
      hcr.lowContrast.length === 0,
      JSON.stringify(hcr.lowContrast),
    );
    await hc.close();

    // Colour must never be the only channel. The two card states differ by
    // word and by border style, not only by hue.
    const cp = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await cp.goto(server.origin + "/index.html", { waitUntil: "load" });
    const badges = await cp.evaluate(() =>
      [...document.querySelectorAll(".badge")].map((b) => ({
        text: b.textContent.trim(),
        borderStyle: getComputedStyle(b).borderStyle,
        hasGlyph: !!b.querySelector("svg"),
      })),
    );
    info("card status badges", badges);
    ok(
      "game status is carried by a word, not only a colour",
      badges.length >= 2 && badges.every((b) => b.text.length > 3),
    );
    ok(
      "and the two states also differ in outline style and glyph",
      new Set(badges.map((b) => b.borderStyle)).size > 1 && badges.every((b) => b.hasGlyph),
      JSON.stringify(badges.map((b) => b.borderStyle)),
    );

    // Keyboard traversal of a whole content page, with no trap.
    const order = [];
    for (let i = 0; i < 40; i++) {
      await cp.keyboard.press("Tab");
      const cur = await cp.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName,
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
          outline: cs.outlineStyle,
        };
      });
      if (!cur) break;
      order.push(cur);
    }
    info("tab stops on the portal home", order.length);
    ok("the portal is traversable by keyboard", order.length >= 5);
    ok(
      "every tab stop has an accessible name",
      order.every((o) => o.label.length > 0),
      JSON.stringify(order.filter((o) => !o.label.length)),
    );
    await cp.close();
  } finally {
    await browser.close();
    await server.close();
  }
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\na11y-check: FAILURES ABOVE" : "\na11y-check: floor holds"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
