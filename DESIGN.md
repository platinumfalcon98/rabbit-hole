# Rabbit Hole — Design System (Retro Terminal)

Established during the full UI redesign, 2026-07-03. This is the reference for
future styling work — new panels/components should be built from these tokens,
not one-off values.

## Direction

**Retro terminal.** Monospace-forward typography, CRT/phosphor flavor,
restrained scanline texture. The dashboard is a tool a developer stares at
daily inside VS Code, so legibility and information density win over kitsch.

## Where the tokens live

All tokens are CSS custom properties defined in the `:root` block at the top
of `src/webview/style.css` (after the `@font-face` declarations), prefixed
`--rh-*` (Rabbit Hole). Chart/heatmap code (`charts.ts`, `heatmap.ts`) reads
the same values via `getCssVar('--rh-*')` so the palette only needs to change
in one place.

## Palette

The palette is **dynamic** (added 2026-07-07): the retro-terminal identity is
kept, but the phosphor is re-tinted to match the host VS Code theme, and light
host themes get a "paper terminal" variant. See "Dynamic theme derivation"
below. The values in this table are the **static defaults** in `style.css`'s
`:root` — the shipped green phosphor look, which is also the fallback whenever
derivation can't parse the host theme's colors:

| Token | Value | Role |
|---|---|---|
| `--rh-void` | `#06090a` | page/body background |
| `--rh-surface` | `#0a0f0d` | sidebar background |
| `--rh-surface-raised` | `#101613` | floating panels (popovers, modal) |
| `--rh-card-bg` | `color-mix(..., black 14%)` | cards — darker than the page |
| `--rh-border` / `--rh-border-bright` | `#1e2b25` / `#2c4436` | dividers / card borders |
| `--rh-text` | `#dcfbe6` | primary text (phosphor white-green) |
| `--rh-text-dim` | `#86a596` | secondary text / labels |
| `--rh-text-muted` | `#5b7468` | tertiary / disabled |

**Accent roles** — deliberately split so "this is clickable" and "this is a
positive number" never collide:

| Token | Value | Role |
|---|---|---|
| `--rh-accent` (amber) | `#ffb703` | primary interactive/chrome: buttons, active nav, focus ring, selection |
| `--rh-success` (phosphor green) | `#39ff6a` | positive states: lines added, streak, saved-flash |
| `--rh-danger` (red) | `#ff5c5c` | negative: lines deleted |
| `--rh-info` (cyan) | `#4fd8ff` | secondary chart accent, available for future series |

Amber and green are both bright — text drawn on a solid fill of either uses
`--rh-on-accent` (`#1a1300`) or `--rh-on-success` (`#06210e`), never white,
to hold WCAG AA contrast.

Native form controls (`<select>`, `<input>`, checkboxes) don't use `--rh-*`
surfaces at all: they use `--vscode-dropdown-*` / `--vscode-input-*` /
`--vscode-badge-*` so they render as expected VS Code controls and stay
legible against any host theme, light or dark.

## Dynamic theme derivation

`src/webview/derivePalette.ts` (shared by the dashboard bundle and the mini
panel's `miniTheme.ts` entry) rebuilds the `--rh-*` tokens from the host
theme at webview boot and on every theme switch (watched via the
`data-vscode-theme-*` attributes VS Code stamps on `<body>`):

- **Hue source:** the first *chromatic* color among `--vscode-focusBorder` →
  `--vscode-activityBarBadge-background` → `--vscode-button-background` →
  `--vscode-textLink-foreground`. Only the **hue** is taken; every token's
  saturation/lightness anchors are lifted from the green phosphor defaults
  (e.g. `--rh-text` ≈ hsl(H, 79%, 92%)), so a green-accented host reproduces
  the shipped look and any other hue gets the same relationships re-tinted.
- **Dark host themes:** dark CRT shell always; phosphor hue = host hue.
  Interactive chrome stays amber unless the phosphor itself lands near amber
  (then chrome flips to the cool complement). `--rh-success` / `--rh-danger`
  are **fixed** — lines added must always read green, deleted red.
- **Light host themes:** "paper terminal" — dark ink (same host hue) on warm
  paper, cards lighter than the page, phosphor bloom replaced by flat paper
  shadows, `--rh-glow-text*` set to `none`, CRT dressing (scanlines, glare,
  vignette — tokenized as `--rh-scanline` / `--rh-glare-*` / `--rh-vig-*`)
  dialed way down. `style.css` also statically disables the `#rh-phosphor`
  chart filter and SVG drop-shadow glows under `body.vscode-light` /
  `body.vscode-high-contrast-light`, and `charts.ts`'s `phosphorDatasetGlow`
  plugin skips its canvas shadow there.
- **Near-achromatic accents** (gray/minimal themes): "white phosphor" tube —
  same lightness ladder at a whisper of saturation; chrome stays amber.
- **Mechanism:** values are written as inline custom properties on `<html>`,
  overriding the `:root` statics; on failure they're removed so the green
  defaults show through. Charts/heatmap repaint via `renderAll()` when the
  derived palette actually changes (mini panel: `rh-theme-changed` event).

## Type scale

`--rh-text-2xs` (0.68em) → `--rh-text-3xl` (2.5em), doubling roughly every 2
steps: `2xs 0.68 / xs 0.75 / sm 0.85 / md 1 / lg 1.15 / xl 1.35 / 2xl 1.9 / 3xl 2.5`.
Existing rules mostly predate this scale with hand-picked em values that
already land close to these steps — new components should pull from the
named tokens instead of picking a fresh number.

## Fonts — 3 typefaces, each with exactly one job

Previously the codebase loaded 6 typefaces (Press Start 2P, Electrolize,
VT323, Unica One, Quantico, Funnel Sans) but only inconsistently used all of
them — this was a direct contributor to the "lacks rhythm" complaint. Quantico
and Funnel Sans have been **removed** and their handful of call sites folded
into Electrolize. VT323 was later also **dropped** (unreadable at the 10–13px
sizes it was used at); `--rh-font-mono` and `CHART_FONT_MONO` now resolve to
Electrolize, with `font-variant-numeric: tabular-nums` doing the digit
alignment a mono face used to provide:

| Token | Font | Used for |
|---|---|---|
| `--rh-font-display` | Press Start 2P | streak hero numeral only |
| `--rh-font-label` | Electrolize | labels, section/widget titles, nav, stat labels, settings labels |
| `--rh-font-mono` | Electrolize | data values: session times, file diffs, chart axes, heatmap labels |
| `--rh-font-stat` | Unica One | large stat numerals (active time, lines added/deleted) |

Native inputs/buttons keep `var(--vscode-font-family)` — that's a deliberate
choice, not an oversight: OS-native controls read as more trustworthy/legible
at small sizes than a display font would.

All font files are already bundled under `src/webview/fonts/` and loaded via
relative `url()` in `@font-face`, which resolves correctly through the
webview's `asWebviewUri`-rewritten stylesheet — no CSP or asset-loading
changes were needed for this redesign.

## Spacing scale

4px grid: `--rh-space-1` (4px) through `--rh-space-8` (32px). Existing layout
paddings/gaps were mostly already on a 4px rhythm; new components should use
the named tokens (`var(--rh-space-3)` etc.) instead of a bare `12px`.

## Radii

`--rh-radius-sm` 4px / `--rh-radius-md` 6px / `--rh-radius-lg` 8px /
`--rh-radius-xl` 10px. Cards use `lg`, small controls use `sm`/`md`, popovers
use `xl`.

## Depth / glow recipe

Cards keep the previously-established pattern (darker fill than the page,
plus a colored glow) but restyled as phosphor bloom instead of a generic
drop shadow. The bloom is two-layer: a tight bright halo at the card edge
plus a wide soft spill:

```css
background: var(--rh-card-bg);
border: 1px solid var(--rh-border-bright);
border-radius: var(--rh-radius-lg);
box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5),
            0 0 10px rgba(var(--rh-accent-rgb), 0.16),
            0 0 36px rgba(var(--rh-accent-rgb), 0.1);
```

Tokenized as `--rh-shadow-card` / `--rh-shadow-card-hover`. Success/danger
variants (`--rh-glow-success`, `--rh-glow-danger`) exist for state-specific
glows (e.g. the streak pill).

## Text phosphor glow

All text carries a faint phosphor glow via an inherited `text-shadow` set
once on `body`. The shadow color is `color-mix(… currentColor …)`, which
resolves per element — amber chrome glows amber, green diffs glow green,
dim text glows dimly — with no per-component rules. Two tokens:
`--rh-glow-text` (tight 2px blur at high gain — a hot edge rather than a
haze) and `--rh-glow-text-strong` (near-solid 2px core + 7px halo). Strong
opt-ins: the large numerals (`.stat-value`, `.activity-stat-value`,
`#streak-count`), card titles (`.widget-title`), all `button`s, and the
date select. Sidebar nav icons are SVG (no `text-shadow`), so they mirror
the strong glow with stacked accent-colored `drop-shadow`s.

## Chart / graph phosphor glow

Canvas charts and the SVG heatmap can't use `text-shadow`, so they share a
single SVG filter (`#rh-phosphor`, defined once in the `dashboardPanel.ts`
HTML shell): `feGaussianBlur` (stdDeviation 1.2) blurs the source in its
own colors, and `feMerge` stacks the bloom twice under the original — the
same tight, high-gain recipe as the text glow. Applied from `style.css`
via `filter: url(#rh-phosphor)` to the four chart canvases and
`#heatmap-canvas svg`. GPU-composited; only re-evaluated when the chart
repaints.

## CRT scanline texture

A single `body::after` fixed pseudo-element with a `repeating-linear-gradient`
(3px repeat, 1px dark line, ~4% opacity via `mix-blend-mode: overlay`). No
image assets, no extra DOM node, negligible compositing cost — safe for a
webview that stays open all day. Deliberately faint: it should read as
texture on a second look, not announce itself.

## CRT glass bulge

A `body::before` fixed pseudo-element that suggests tube curvature without
distorting content (a real displacement filter would warp/blur text). Three
cues, all flat gradient layers with the same negligible compositing cost as
the scanlines: rounded screen corners (four 14px corner gradients masking to
black), a faint specular glare near the top edge plus a soft center bloom
(~4% alpha each ─ the bloom is the point of the tube nearest the viewer),
and a barrel vignette that starts falling off mid-screen (clear through
~42%, ~55% black at the extreme corners) so the curvature reads across the
whole viewport, not just at the edges.
Sits at `z-index: 1000`, above the scanlines, since glare and vignette live
on the glass while scanlines live on the phosphor.

## What changed per area

- **Streak pill**: fire emoji (`&#x1F525;`, inconsistent cross-platform
  rendering) replaced with an inline SVG spark icon using `currentColor`, so
  it recolors with state (`--rh-success` when active, `--rh-text-muted` when
  at-risk). The pill is deliberately **plain** — no card container, border,
  glow, or strong text-shadow (a bordered/glowing version was tried and
  rejected); state is carried by color alone. Digit-scaling logic in
  `main.ts` (1/2/3+ digit font-size) is unchanged — it was already correct.
- **Cards** (`.stat-group`, `.section-card`, `.chart-box`, `.settings-card`,
  `.project-card`): fill and border now come from `--rh-card-bg` /
  `--rh-border-bright` instead of `color-mix(...vscode-editorWidget-
  background...)`, so they're visually consistent with the rest of the fixed
  dark shell.
- **Floating surfaces** (calendar popover, project dropdown, export modal):
  moved from `--vscode-editorWidget-background` to `--rh-surface-raised`.
- **All body/label/description text** that renders on top of the dashboard's
  own surfaces was moved from `--vscode-editor-foreground` /
  `--vscode-foreground` / `--vscode-descriptionForeground` to `--rh-text` /
  `--rh-text-dim` — necessary once the surfaces stopped tracking the host
  theme, otherwise text could go invisible in a light VS Code theme. Native
  form controls were left on their paired `--vscode-dropdown-foreground` /
  `--vscode-input-foreground` / `--vscode-badge-foreground` since those
  backgrounds are still theme-native.
- **Interactive accent** everywhere (`nav-item.active`, `proj-filter-btn`,
  buttons, focus ring, calendar selection, checkboxes) moved from orange
  `#f97316` to phosphor amber `--rh-accent`.

## Deferred / out of scope for this pass

- Border/divider color (`var(--vscode-editorWidget-border)`) was left as-is
  throughout — it's a low-risk theme-linked gray that still reads as a
  divider against the fixed dark shell in both light and dark host themes.
  A future pass could move these to `--rh-border` for full token coverage.
- Primary action buttons (`.modal-btn-primary`, `.export-pdf-btn`,
  `.setting-apply`, etc.) still use `var(--vscode-font-family)` rather than
  `--rh-font-label`, to keep small-size legibility on native-styled buttons.
- Chart.js and SVG heatmap restyling (colors, fonts, tooltips, gradient) was
  delegated to the dashboard-chart-engineer agent with this token set — see
  that agent's changes in `src/webview/charts.ts` and `src/webview/heatmap.ts`.
