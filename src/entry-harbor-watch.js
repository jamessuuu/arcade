/**
 * Entry point for one game. This is the entire per-game boilerplate: import
 * the game module, hand it to the shell. Adding game two is this file with a
 * different import, plus a card in index.html.
 */
import { mountGame } from "./runtime/shell.js";
import * as harborWatch from "./games/harbor-watch/index.js";

mountGame(harborWatch).catch((err) => {
  // A game that cannot start must say so rather than showing a black canvas.
  console.error(err);
  const app = document.getElementById("app");
  if (app) {
    app.innerHTML = `<div class="page prose">
      <h1>Harbor Watch could not start</h1>
      <p>This browser could not open the drawing surface the game needs
      (WebGL). Nothing was sent anywhere and nothing was saved.</p>
      <p><a href="./index.html">Back to The Quiet Arcade</a></p>
      <p><code>${String(err && err.message ? err.message : err)}</code></p>
    </div>`;
    document.body.classList.remove("playing");
  }
});
