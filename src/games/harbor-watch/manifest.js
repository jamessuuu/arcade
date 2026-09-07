/**
 * HARBOR WATCH — the manifest.
 *
 * Deliberately in its own module with NO PixiJS import anywhere in its
 * dependency graph. The portal home and the parents page both need to read a
 * game's identity, its modes and its session length; neither should have to
 * download a renderer to do it. Every game must keep this separation or the
 * portal's first-load budget becomes the sum of every game's engine.
 */

import { MODES } from "./feel.js";

export const manifest = {
  id: "harbor-watch",
  title: "Harbor Watch",
  teaser: "Hold the line",
  tagline:
    "A lamp shows one mark. Let in the ships that match it, turn away the ones that do not, and keep your nerve until dawn.",
  verbLabel: "Hold to raise the boom",
  verb: "Hold",
  ground: 0x070b18,
  session: "About 3 minutes",
  padGlyph:
    '<svg viewBox="0 0 132 56" width="118" height="50" aria-hidden="true"><rect x="2" y="30" width="14" height="24" rx="2" fill="currentColor"/><rect x="116" y="30" width="14" height="24" rx="2" fill="currentColor"/><rect x="16" y="12" width="100" height="14" rx="3" fill="currentColor"/><path d="M24 26l9-14h9l-9 14zM46 26l9-14h9l-9 14zM68 26l9-14h9l-9 14zM90 26l9-14h9l-9 14z" fill="#070b18"/><path d="M66 0l-9 9h18z" fill="currentColor"/></svg>',
  modes: Object.values(MODES).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    glyph:
      m.id === "gentle"
        ? '<svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 22c4-6 8-6 12 0s8 6 12 0"/><circle cx="17" cy="9" r="4"/></svg>'
        : m.id === "standard"
          ? '<svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="17" cy="17" r="12"/><path d="M17 9v8l6 4"/></svg>'
          : '<svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 27h24M9 27V11l8-6 8 6v16"/><path d="M17 27v-8"/></svg>',
  })),
};
