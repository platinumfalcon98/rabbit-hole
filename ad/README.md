# Rabbit Hole promo film

A 70-second, 1440×1080, 60 fps promo film for the Rabbit Hole VS Code extension,
built with [Remotion](https://www.remotion.dev/) from the extension's real dashboard UI.
Spec: `docs/superpowers/specs/2026-10-08-promo-video-design.md`.

Storyboard: [`storyboard.md`](storyboard.md).

## Setup

```bash
cd ad
npm install
node scripts/setup-audio.mjs     # copies the Quartz excerpt + the Mixkit hum into public/local/ (gitignored)
node scripts/synth.mjs           # regenerates public/sfx/synth/*.wav (committed; deterministic)
```

`setup-audio.mjs` takes the two source paths as optional arguments (defaults:
`~/Music/for edits/Quartz.mp3`, `~/Downloads/mixkit-technological-futuristic-hum-2133.wav`).

## Preview, render, finish

```bash
npm run studio                   # Remotion Studio (builds the UI first)
npm run render                   # out/promo-raw.mp4 (~75 min on 16 threads)
node scripts/finish.mjs          # loudness pass + poster, storyboard stills, contact sheets
npm test                         # timeline, showcase data, cue sheet, cursor, captions
npm run typecheck
```

Helpers: `node scripts/sheet.mjs <name> <frame>…` renders stills into a sheet under `out/checks/`;
`npx tsx scripts/measure-ui.ts` re-measures where the real UI puts the cursor's targets
(`src/scenes/layout.json`) after a change to `src/scenes/shots.ts`; `node scripts/measure-beat.mjs`
and `node scripts/measure-key.mjs` measure the music.

## Layout

- `src/timeline.ts` — the measured beat grid (99.75 BPM, phase 0.3675 s) and the scenes snapped to bars.
- `src/data/showcase.ts` — the invented dataset, typed with the extension's own types; `agentLive.ts`
  — the live updates the agent and streak scenes send.
- `src/scenes/` — one component per storyboard row; the choreography (cursor paths, cameras, reveal
  timings, sound cues) lives in the pure `plan*.ts` files so pictures and sounds share one source.
- `src/captions/` — the caption kit (slam, decode, stretch, glitch, flicker) and the film's captions.
- `src/cursor/`, `src/fx/` — the mouse, the camera, the CRT pass, the fisheye, the backlight.
- `src/audio/` — the cue scheduler (no two onsets within 2 frames), the film-wide cue sheet, the soundtrack.
- `ui-host/`, `scripts/build-ui.mjs`, `src/ui/` — the real UI host (below).

## The CRT pass

The whole frame goes through an SVG filter chain (a wide gaussian bloom screened back onto the image,
then an `feDisplacementMap` barrel warp from a generated map), with an aperture grille (fine pitch,
34%, from the extension's own `crtParams`) and scanlines inside the warp, and the glass (vignette,
glare, rounded bezel) plus a frame-seeded ±1.5% flicker over it. WebGL was not used: a shader cannot
read DOM or iframe pixels, the SVG filter can, deterministically. Scanlines use a 4 px period (the
extension's 3 px aliases in the 400 px phone downscale).

## Licences

- Remotion: free for individuals and companies of up to 3 people (remotion.dev/license).
- Kenney UI Audio / Interface Sounds: CC0 (`public/sfx/kenney/LICENSE-*.txt`, `SOURCES.txt`).
- Synthesised sounds: made here, part of this project.
- Martian Mono: OFL (the extension's own copy).
- The Mixkit hum is used under the Mixkit Sound Effects Free License — confirm before release; it is
  not committed (public/local/).
- **Quartz is not included** and never committed; the render needs a local copy.

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
