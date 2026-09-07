/**
 * Everything, in the order that fails fastest first.
 *
 * `node tests/run-all.mjs` is the gate. The full play test runs in its fast
 * mode here so the suite stays usable; the real-time, real-GPU run is
 * `npm run verify:play -- --headed` and its numbers are the ones quoted in the
 * README, because a software-rasterised frame time is not a frame time.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITE = [
  ["control-byte-sweep.mjs", [], "no silently-dead escapes anywhere"],
  ["spawn-floor.mjs", [], "fairness floors over 3000 generated shifts"],
  ["claims-check.mjs", [], "the claims gate"],
  ["dark-pattern-check.mjs", [], "the dark-pattern gate"],
  ["network-capture.mjs", [], "the nothing-leaves-your-device receipt"],
  ["a11y-check.mjs", [], "the accessibility floor"],
  ["menus.mjs", [], "mouse, touch and keyboard through the whole shell"],
  ["mechanics.mjs", [], "discrimination, determinism, pause, motion, save recovery"],
  ["bundle-budget.mjs", [], "measured payload"],
  ["play-harbor-watch.mjs", ["--fast"], "a driven playthrough"],
];

function runOne(file, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(HERE, file), ...args], {
      stdio: "inherit",
      cwd: join(HERE, ".."),
    });
    p.on("close", (code) => resolve(code ?? 1));
  });
}

let failed = 0;
for (const [file, args, label] of SUITE) {
  console.log(`\n${"=".repeat(72)}\n  ${label}\n  node tests/${file} ${args.join(" ")}\n${"=".repeat(72)}`);
  const code = await runOne(file, args);
  if (code !== 0) failed++;
}

console.log(`\n${"=".repeat(72)}`);
if (failed) {
  console.log(`  ${failed} of ${SUITE.length} suites FAILED`);
  process.exitCode = 1;
} else {
  console.log(`  all ${SUITE.length} suites passed`);
}
