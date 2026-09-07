/**
 * A standing guard against a failure mode that already cost this project a
 * silently-dead checker.
 *
 * Writing regex source through a shell heredoc collapsed every `\b` into a
 * literal BACKSPACE byte (0x08). The pattern then matched nothing at all,
 * while its check reported a clean pass — which is strictly worse than a
 * crash, because a dead checker's "no findings" is indistinguishable from a
 * real one. It was caught with `cat -A` showing `^H`, not by any test.
 *
 * So: every text file in the repository is swept for C0 control bytes other
 * than tab, newline and carriage return. There is no legitimate reason for one
 * to appear in source, HTML, CSS, Markdown or JSON here.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { ROOT, ok, info, isMain } from "./lib.mjs";

const SKIP = new Set(["node_modules", ".git", "dist"]);
const EXT = new Set([".js", ".mjs", ".html", ".css", ".md", ".json", ".svg", ".txt"]);

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (EXT.has(extname(e.name))) yield full;
  }
}

export function findControlBytes(text) {
  const bad = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
      bad.push({
        code: "0x" + c.toString(16).padStart(2, "0"),
        near: text.slice(Math.max(0, i - 34), i + 22).replace(/\n/g, " "),
      });
    }
  }
  return bad;
}

export async function run() {
  // The sweep must be able to see a planted byte before its silence counts.
  ok(
    "the sweep detects a planted backspace byte",
    findControlBytes("const r = /" + String.fromCharCode(8) + "word/;").length === 1,
  );
  ok(
    "and does not fire on ordinary source",
    findControlBytes("const r = /\\bword\\b/;\n\tindented\r\n").length === 0,
  );

  let scanned = 0;
  const dirty = [];
  for await (const f of walk(ROOT)) {
    const bad = findControlBytes(await readFile(f, "utf8"));
    scanned++;
    if (bad.length) dirty.push({ file: relative(ROOT, f), bad });
  }

  info("text files swept", scanned);
  ok(
    "no stray control byte anywhere in the repository",
    dirty.length === 0,
    dirty
      .map((d) => `${d.file}: ${d.bad.map((b) => b.code + " near " + b.near).join("; ")}`)
      .join(" | "),
  );
}

if (isMain(import.meta.url)) {
  run().then(
    () => console.log(process.exitCode ? "\ncontrol-byte-sweep: FAILURES ABOVE" : "\ncontrol-byte-sweep: clean"),
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
