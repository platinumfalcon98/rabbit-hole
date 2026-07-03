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

The dashboard **asserts its own dark surface** rather than following the host
VS Code theme:

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

**Why assert our own palette instead of following `--vscode-*`:** a
retro-terminal identity needs a fixed phosphor-on-black relationship to read
correctly — it can't be legible in a user's light theme by definition. Native
form controls (`<select>`, `<input>`, checkboxes) are the exception: they
still use `--vscode-dropdown-*` / `--vscode-input-*` / `--vscode-badge-*` so
they render as expected VS Code controls and stay legible against any host
theme, light or dark.

## Type scale

`--rh-text-2xs` (0.68em) → `--rh-text-3xl` (2.5em), doubling roughly every 2
steps: `2xs 0.68 / xs 0.75 / sm 0.85 / md 1 / lg 1.15 / xl 1.35 / 2xl 1.9 / 3xl 2.5`.
Existing rules mostly predate this scale with hand-picked em values that
already land close to these steps — new components should pull from the
named tokens instead of picking a fresh number.

## Fonts — 4 typefaces, each with exactly one job

Previously the codebase loaded 6 typefaces (Press Start 2P, Electrolize,
VT323, Unica One, Quantico, Funnel Sans) but only inconsistently used all of
them — this was a direct contributor to the "lacks rhythm" complaint. Quantico
and Funnel Sans have been **removed** and their handful of call sites folded
into Electrolize:

| Token | Font | Used for |
|---|---|---|
| `--rh-font-display` | Press Start 2P | streak hero numeral only |
| `--rh-font-label` | Electrolize | labels, section/widget titles, nav, stat labels, settings labels |
| `--rh-font-mono` | VT323 | data values: session times, file diffs, language legend values |
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
plus a faint colored glow) but restyled as phosphor bloom instead of a
generic drop shadow:

```css
background: var(--rh-card-bg);
border: 1px solid var(--rh-border-bright);
border-radius: var(--rh-radius-lg);
box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5), 0 0 20px rgba(var(--rh-accent-rgb), 0.08);
```

Tokenized as `--rh-shadow-card` / `--rh-shadow-card-hover`. Success/danger
variants (`--rh-glow-success`, `--rh-glow-danger`) exist for state-specific
glows (e.g. the streak pill).

## CRT scanline texture

A single `body::after` fixed pseudo-element with a `repeating-linear-gradient`
(3px repeat, 1px dark line, ~4% opacity via `mix-blend-mode: overlay`). No
image assets, no extra DOM node, negligible compositing cost — safe for a
webview that stays open all day. Deliberately faint: it should read as
texture on a second look, not announce itself.

## What changed per area

- **Streak pill**: fire emoji (`&#x1F525;`, inconsistent cross-platform
  rendering) replaced with an inline SVG spark icon using `currentColor`, so
  it recolors with state (`--rh-success` when active, `--rh-text-muted` when
  at-risk) and picks up a phosphor `drop-shadow` glow. The pill itself is now
  a bordered container (`--rh-card-bg` fill, `--rh-glow-success` shadow)
  instead of bare inline text, and dims that glow/border in the at-risk
  state. Digit-scaling logic in `main.ts` (1/2/3+ digit font-size) is
  unchanged — it was already correct.
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
