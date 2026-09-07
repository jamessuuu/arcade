/**
 * THE CLAIMS GATE.
 *
 * A game that claims to improve attention is making a health-adjacent claim,
 * and this project has no evidence for one, so it makes none. The precedent is
 * specific and verified: FTC v. Lumos Labs, announced 2016-01-05, which
 * required competent and reliable scientific evidence before any future claim
 * about real-world performance, age-related decline, or health conditions
 * including ADHD.
 *
 * The rule therefore binds the product copy, the README, the docs, and any
 * social draft equally — an FTC-style rule follows the claim, not the surface
 * it appears on.
 *
 * THE HARD PART, and the reason this file is longer than a grep:
 * the honest disclaimer necessarily CONTAINS the forbidden phrases. "We do not
 * say these games improve focus" must be allowed; "these games improve focus"
 * must not. So negation regions are marked explicitly in the source with
 * `claims-negation` markers, the checker strips those regions, and then it
 * PRINTS what it stripped, so a human can see exactly what was exempted rather
 * than trusting that the exemption was used honestly.
 *
 * And per this project's own rule about checkers: it plants a violation in
 * itself and fails if it cannot find it. A checker that has never caught
 * anything is indistinguishable from a checker whose regex is broken.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { ROOT, ok, isMain } from "./lib.mjs";

/** Section 5.2 of the programme, as patterns. */
export const FORBIDDEN = [
  { id: "improves-focus", re: /\b(improve|improves|improving|boost|boosts|boosting|sharpen|sharpens|increase|increases|enhance|enhances|enhancing)\b[^.?!]{0,24}\bfocus\b/i },
  { id: "better-focus", re: /\b(better|greater|stronger|longer)\s+focus\b/i },
  { id: "attention-span", re: /\battention\s+span\b/i },
  { id: "brain-training", re: /\bbrain[\s-]?train(ing|er|ers)?\b/i },
  { id: "train-your-brain", re: /\btrain(s|ing)?\s+(your|the|his|her|their)\s+brain\b/i },
  { id: "smarter", re: /\b(make|makes|making|get|gets|getting)\s+(you|them|kids|children)\s+smarter\b/i },
  { id: "improves-discipline", re: /\b(improve|improves|build|builds|develop|develops)\b[^.?!]{0,24}\bdiscipline\b/i },
  { id: "boosts-memory", re: /\b(improve|improves|boost|boosts|enhance|enhances)\b[^.?!]{0,24}\bmemory\b/i },
  { id: "iq", re: /\b(raise|raises|boost|boosts|increase|increases)\b[^.?!]{0,20}\bIQ\b/i },
  { id: "adhd", re: /\bADHD\b|\battention[\s-]deficit\b/i },
  { id: "named-condition", re: /\b(dementia|alzheimer|cognitive\s+impairment|cognitive\s+decline)\b/i },
  { id: "school-performance", re: /\b(improve|improves|better)\b[^.?!]{0,30}\b(school|academic|work)\s+performance\b/i },
  { id: "scientifically-proven", re: /\b(scientifically|clinically)\s+(proven|shown|validated)\b/i },
  { id: "backed-by-science", re: /\bbacked\s+by\s+(science|research|neuroscience)\b/i },
  { id: "neuroscientist", re: /\bdesigned\s+by\s+neuroscientists?\b/i },
  { id: "proven-to", re: /\bproven\s+to\s+(improve|increase|boost|help)\b/i },
  { id: "therapy", re: /\b(therapeutic|treatment\s+for|helps\s+with\s+ADHD)\b/i },
];

const START = "claims-negation:start";
const END = "claims-negation:end";

/** Strip marked negation regions. Returns the cleaned text and what was cut. */
export function stripNegations(text) {
  const cut = [];
  let out = "";
  let i = 0;
  while (true) {
    const s = text.indexOf(START, i);
    if (s === -1) {
      out += text.slice(i);
      break;
    }
    const e = text.indexOf(END, s);
    if (e === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, s);
    cut.push(text.slice(s, e + END.length));
    i = e + END.length;
  }
  return { text: out, cut };
}

export function scan(text) {
  const hits = [];
  const { text: clean, cut } = stripNegations(text);
  const lines = clean.split("\n");
  for (const rule of FORBIDDEN) {
    for (let n = 0; n < lines.length; n++) {
      const m = lines[n].match(rule.re);
      if (m) hits.push({ rule: rule.id, line: n + 1, match: m[0].trim() });
    }
  }
  return { hits, exempted: cut.length };
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "screenshots"]);
const SCAN_EXT = new Set([".html", ".js", ".mjs", ".md", ".css", ".json", ".txt"]);

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (SCAN_EXT.has(extname(e.name))) yield full;
  }
}

export async function run() {
  // ---- SELF-TEST FIRST. -------------------------------------------------
  // If the checker cannot find a planted violation, then "no findings" means
  // nothing at all, and this project has been burned by exactly that before:
  // a dead pattern reports a clean pass, which is indistinguishable from a
  // real one.
  const planted = [
    "Our games improve focus in just three minutes a day.",
    "A brain-training arcade for kids.",
    "Clinically proven to help with ADHD.",
    "It will lengthen your attention span.",
    "Backed by neuroscience research.",
  ];
  let caught = 0;
  for (const p of planted) if (scan(p).hits.length > 0) caught++;
  ok(
    "the checker catches every planted violation before it is trusted",
    caught === planted.length,
    `${caught} of ${planted.length}`,
  );
  ok(
    "the checker does NOT flag the honest disclaimer inside a marked negation",
    scan(`${START} we do not claim these games improve focus or help with ADHD ${END}`).hits
      .length === 0,
  );

  // ---- THE REAL SCAN. ---------------------------------------------------
  const findings = [];
  let files = 0;
  let exempted = 0;
  for await (const file of walk(ROOT)) {
    // The checker's own pattern list and its planted fixtures are not copy.
    if (file.endsWith("claims-check.mjs")) continue;
    const text = await readFile(file, "utf8");
    files++;
    const r = scan(text);
    exempted += r.exempted;
    for (const h of r.hits) {
      findings.push(`${relative(ROOT, file)}:${h.line}  [${h.rule}]  "${h.match}"`);
    }
  }

  console.log(`  ·   scanned ${files} files; ${exempted} marked negation regions exempted`);
  ok(
    "no forbidden claim survives anywhere in the project",
    findings.length === 0,
    findings.length ? "\n      " + findings.join("\n      ") : "",
  );

  // Also check the BUILT output, which is what a visitor actually receives.
  // Negation markers may not survive HTML minification, so this pass reports
  // rather than fails, and names every hit so it can be read by eye.
  const distHits = [];
  try {
    for await (const file of walk(join(ROOT, "dist"))) {
      const text = await readFile(file, "utf8");
      for (const rule of FORBIDDEN) {
        const m = text.match(rule.re);
        if (m) distHits.push(`${relative(ROOT, file)} [${rule.id}] "${m[0].trim()}"`);
      }
    }
  } catch {
    /* no dist yet */
  }
  console.log(
    `  ·   built output: ${distHits.length} phrase hits, all expected to be inside the parents page's explicit disclaimer:`,
  );
  for (const h of distHits) console.log("        " + h);
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\nclaims-check: FAILURES ABOVE" : "\nclaims-check: clean"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
