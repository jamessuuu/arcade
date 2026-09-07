/**
 * The parents page is the one page on this site that must not be able to lie,
 * so it reads its numbers out of the build rather than repeating them.
 *
 * - Session lengths come from the games' own mode tables. If a designer
 *   lengthens a watch, this page changes with it and nobody has to remember.
 * - The storage dump is a live read of this browser, printed raw. A page that
 *   describes what it stores is a claim; a page that prints it is a receipt.
 */

import { FEEL, MODES } from "./games/harbor-watch/feel.js";
import { manifest } from "./games/harbor-watch/manifest.js";
import { Save } from "./runtime/save.js";

const GAMES = [{ manifest, modes: MODES }];

function fmt(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s} seconds`;
  return `${m} min ${String(s).padStart(2, "0")} s`;
}

function renderSessions() {
  const tbody = document.getElementById("sessionTable");
  if (!tbody) return;
  const rows = [];
  for (const g of GAMES) {
    for (const mode of Object.values(g.modes)) {
      const play = mode.watches.reduce((a, w) => a + w.seconds, 0);
      const total = play + FEEL.dawnSeconds;
      rows.push(
        `<tr><th scope="row">${g.manifest.title} &mdash; ${mode.name}</th><td>${fmt(total)} (${mode.watches.length} watches, then the run ends)</td></tr>`,
      );
    }
  }
  tbody.innerHTML = rows.join("");
}

function renderStorage() {
  const pre = document.getElementById("storageDump");
  if (!pre) return;
  let out = "";
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    if (!keys.length) {
      out =
        "Nothing. This browser is storing no values at all for this site.\n\nThat is what you see before you have played, and after you press erase.";
    } else {
      out = keys
        .sort()
        .map((k) => {
          let v = localStorage.getItem(k) ?? "";
          try {
            v = JSON.stringify(JSON.parse(v), null, 2);
          } catch {
            /* print it raw if it is not JSON */
          }
          return `${k}\n${v}`;
        })
        .join("\n\n");
      out +=
        "\n\n— that is the whole of it. There is no other storage: no cookie, no IndexedDB, no service worker, nothing on a server.";
    }
  } catch (err) {
    out =
      "This browser will not let a page read its own storage (private mode, or storage is blocked). That is fine — the games work without it, they simply forget your settings.\n\n" +
      String(err);
  }
  pre.textContent = out;
}

function wireGate() {
  const gate = document.getElementById("gate");
  const area = document.getElementById("eraseArea");
  const answer = document.getElementById("gateAnswer");
  const msg = document.getElementById("gateMsg");
  const submit = document.getElementById("gateSubmit");
  if (!gate || !area || !answer || !submit) return;

  // A small arithmetic gate. It is not security and is not presented as
  // security: it is the standard "is a grown-up doing this" speed bump, here
  // because the button below is destructive and irreversible.
  const a = 6 + Math.floor(Math.random() * 6);
  const b = 7 + Math.floor(Math.random() * 6);
  document.getElementById("gateA").textContent = String(a);
  document.getElementById("gateB").textContent = String(b);

  const tryUnlock = () => {
    if (Number(answer.value) === a * b) {
      gate.hidden = true;
      area.hidden = false;
      area.querySelector("button")?.focus();
    } else {
      msg.textContent = "Not quite. Have another go.";
      answer.select?.();
    }
  };
  submit.addEventListener("click", tryUnlock);
  answer.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryUnlock();
    }
  });

  document.getElementById("eraseBtn")?.addEventListener("click", () => {
    const save = new Save();
    save.eraseEverything();
    renderStorage();
    const m = document.getElementById("eraseMsg");
    if (m)
      m.textContent =
        "Done. Everything stored for this site has been removed from this browser. The panel above now shows what is left.";
  });
}

renderSessions();
renderStorage();
wireGate();
