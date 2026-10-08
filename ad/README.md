# Rabbit Hole promo film

A 70-second, 1440×1080, 60 fps promo film for the Rabbit Hole VS Code extension,
built with [Remotion](https://www.remotion.dev/) from the extension's real dashboard UI.
Spec: `docs/superpowers/specs/2026-10-08-promo-video-design.md`.

(Setup, preview and render instructions are filled in as the project is built.)

## How the real UI is mounted

Strategy: **iframe running the real, unchanged webview bundles** (chosen after a spike,
2026-10-08). `scripts/build-ui.mjs` builds `src/webview/main.ts` and `mini.ts` exactly as the
extension's `build:webview` does, copies `style.css` / `mini.css` / the font, and extracts the
markup the real `DashboardPanel` / `MiniPanel` generate (with a stub `vscode` module, as
`test/harness/dashboard.js` does), dropping the CSP. `ui-host/` adds, before the real bundle:

- a frozen clock (`Date.now()` = the showcase's NOW, today 21:10),
- a stub `acquireVsCodeApi` answering `ready` / `requestYear` / `requestDays` synchronously
  from `src/data/showcase.ts`,
- `window.__apply(view)`: applies one `UiView` (`src/ui/view.ts`) per frame by clicking the
  real tab / range / project buttons, dispatching real pointer events for hover focus and
  tooltips, merging `live` updates, and writing inline styles / text onto the real elements
  for the entrance animations (`reveal`).

`<UiFrame>` (`src/ui/UiFrame.tsx`) holds each Remotion frame (`delayRender`) until the host has
applied the view and two animation frames have passed. Why not a direct mount: `main.ts` wires
module-level state to fixed element ids, so one document holds exactly one dashboard; an iframe
gives each shot its own instance and runs the bundle byte-for-byte as shipped.

Determinism: every view is absolute (data is re-sent whenever the `live` override changes,
focus is cleared and re-applied, buttons are only clicked when not already pressed). Checked
by rendering `UiCheck` frames 440–470 and 296–304 as a sequence (several tabs, out of order)
and comparing frames 455 / 300 / 899 against single-frame stills: byte-identical PNGs.
