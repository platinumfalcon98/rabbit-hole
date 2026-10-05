# Rabbit Hole — TTY design system

The reference is the [TTY design spec](docs/superpowers/specs/2026-10-04-tty-redesign-design.md) and
the dashboard, sidebar and export mockups in `docs/design/mockups/`.
Implementation lives in `src/webview/`. Preserve the terminal layout and exact
product copy; don't introduce a separate visual language for new panels.

## Tokens and themes

`src/webview/style.css` owns the fixed palettes, keyed on VS Code body classes.
Use its existing variables rather than the retired `--rh-*` tokens.
`--bg` / `--panel` / `--rule` are surfaces and borders; `--ink` / `--ink-dim` /
`--ink-mute` are text; `--chrome` / `--chrome-ink` are interactive accents;
`--add` / `--del` are positive and negative values; `--c1` through `--c6` and
`--c-other` are series colours. There is no host-hue derivation.

Dark phosphor: background #050b08, panel #08110d, rule #22392d,
ink #cfeedd, amber #ffb703, additions #39d98a, deletions #ff6b6b.
Light paper: background #eef0e9, panel #f6f7f2, rule #b9c2b2,
ink #12261b, amber #8a5a00, additions #0f7a43, deletions #b4232f.
High-contrast dark and light use VS Code foreground/background/contrast
tokens and disable CRT and glow. Keep those theme branches together.

## Typography and structure

Martian Mono is bundled: variable woff2 for webviews, static Regular and Bold
TTF for PDF embedding. --mono includes local fallback monospace faces.
Block glyphs in the webview use fallback coverage; exports draw marks as
shapes. PDF textFit.ts checks cmap coverage and replaces unsupported
characters with ?, then fits text within its assigned space.

Use fieldset/legend terminal frames, compact tabular numerals, thin rules,
block columns and tapes, git diff --stat file rows, and amber interaction.
The streak stays plain. No old rounded-card theme or display typefaces.

## Interaction and sidebar

model.ts owns aggregation. state.ts owns dashboard state and requests.
Colours are stable: projects use registry order, languages use unfocused
rank. Hover or keyboard focus narrows a view without moving the target
under the pointer; restore keyboard focus across redraws.

miniPanel.ts is the host shell; mini.ts renders values from miniModel.ts.
The sidebar loads style.css then mini.css, so check selector collisions.
Below 230 px it shows 7 streak marks, drops the week axis and percentages,
and hides every other hour label. Its tape is coloured by project.
The dashboard tape is coloured by language.

## CRT

crt.ts shares the rendering and settings across dashboard and sidebar.
Defaults: slot mask, fine pitch, strength 23%, vignette 35%, scanlines and
bloom enabled. Convergence, roll and flicker are off. Light themes halve
strength; high contrast disables effects. Reduced motion suppresses roll
and flicker. Keep text legible and overlays non-interactive.

## Carrot and workbench icons

src/webview/carrot.ts is the sole 14×10 grid and palette:
O #FF8B00, B #A5510C, G #01FF00. Cell (0,8) is brown.
carrotPixels() supplies renderers; carrotSvg(scale) supplies webview SVGs.
The carrot suite checks both resource SVGs, including paint order.

Activity Bar: resources/icon.svg, monochrome and theme-coloured.
Status bar: `$(rabbithole-carrot)`, registered at U+E001 from the committed
`resources/rabbithole-icons.woff`. It inherits the existing item colour:
`#22c55e` when tracking, default otherwise. Text remains floored
`<today> / <target>` across all projects.

Marketplace: resources/icon.png is an opaque 128×128 RGB tile, the carrot
at 8× (112×80), centred at (8,24) on #06090a. galleryBanner uses that
background with theme dark. The publisher remains a placeholder until
the user supplies their registered id.

## Regenerating assets

From the repository root, with existing npm development dependencies:

```powershell
node scripts/build-icon-png.js
python scripts/build-icon-font.py
```

Font regeneration alone needs fonttools, installed only with user approval:

```powershell
python -m pip install fonttools
```

The committed WOFF was generated with fonttools 4.66.1. Record the version
when regenerating it. Generated PNG and WOFF are committed; ordinary builds,
tests and the installed extension never need Python.

Checks:

```powershell
node scripts/test.js --suite carrot
node scripts/test.js --suite icons
python test/icon-font.test.py
```

The last command is a developer regeneration check, separate from npm test.
Run npm test, typecheck and build before committing asset changes.

## Exports and verification

The share card uses a 420×620 logical canvas at 3× with faint scanlines,
no mask. Reports are dark A4 with #06090a background, a hairline frame,
embedded fonts and no CRT. exportModel.ts and exportLayout.ts own values
and layout; shareCard.ts and reportPdf.ts draw them.

Use the existing dashboard, sidebar and export browser harnesses for
layout checks. Use the real Extension Development Host for workbench icons,
theme changes, visibility, storage and live-update checks. Check the status
glyph at 16 px on Windows and macOS and inspect packaged asset inclusion.
Record unavailable platforms as unverified. Marketplace screenshots follow
the host pass; login and publishing remain user-run.
