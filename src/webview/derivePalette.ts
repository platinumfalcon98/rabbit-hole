// Dynamic theme derivation ── the dashboard keeps its retro-terminal identity
// (dark CRT shell, phosphor glow, amber chrome) but tints the phosphor to
// match the host VS Code theme, and swaps to a light "paper terminal" palette
// when the host theme is light. See DESIGN.md "Palette".
//
// The whole mechanism is: read one accent color from the host theme's
// --vscode-* variables, extract its hue, and rebuild every --rh-* token from
// hue-agnostic S/L anchors (taken from the shipped green phosphor palette).
// Values are written as inline custom properties on <html>, which override
// the static :root defaults in style.css ── if derivation fails (unparseable
// theme colors), the inline props are simply removed and the stylesheet's
// green phosphor palette shows through unchanged.
//
// This runs inside a webview (needs getComputedStyle on the --vscode-* vars),
// shared by the dashboard bundle (main.ts) and the mini panel (miniTheme.ts).

type ThemeKind = "dark" | "light"

interface Hsl { h: number; s: number; l: number }

// ── Color parsing / formatting ─────────────────────────────────────────────

function parseColor(raw: string): Hsl | null {
  const str = raw.trim()
  let r: number, g: number, b: number
  const hex = str.match(/^#([0-9a-f]{3,8})$/i)?.[1]
  if (hex && (hex.length === 3 || hex.length === 4)) {
    r = parseInt(hex[0] + hex[0], 16); g = parseInt(hex[1] + hex[1], 16); b = parseInt(hex[2] + hex[2], 16)
  } else if (hex && (hex.length === 6 || hex.length === 8)) {
    r = parseInt(hex.slice(0, 2), 16); g = parseInt(hex.slice(2, 4), 16); b = parseInt(hex.slice(4, 6), 16)
  } else {
    const rgb = str.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
    if (!rgb) return null
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3])
  }
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return { h, s: s * 100, l: l * 100 }
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s * 10) / 10}%, ${Math.round(l * 10) / 10}%)`
}

// "r, g, b" triplet for the --rh-*-rgb tokens consumed by rgba(var(...), a)
function rgbTriplet(h: number, s: number, l: number): string {
  const hh = (((h % 360) + 360) % 360) / 360; const ss = s / 100; const ll = l / 100
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
  const p = 2 * ll - q
  const chan = (t: number): number => {
    t = ((t % 1) + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [chan(hh + 1 / 3), chan(hh), chan(hh - 1 / 3)].map(c => Math.round(c * 255)).join(", ")
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a % 360) + 360) % 360 - ((b % 360) + 360) % 360)
  return Math.min(d, 360 - d)
}

// ── Palette construction ───────────────────────────────────────────────────

const AMBER_HUE = 43 // --rh-accent #ffb703

// Interactive chrome stays amber (the "clickable = amber" identity) unless
// the phosphor itself lands near amber ── then chrome flips to the cool
// complement so chrome and body text never share a hue.
function accentHue(phosphorHue: number): number {
  return hueDistance(phosphorHue, AMBER_HUE) < 50 ? phosphorHue + 180 : AMBER_HUE
}

/**
 * Build the full --rh-* token set for a given host accent color.
 *
 * Dark: the shipped green phosphor palette with its hue swapped for the host
 * accent's hue. S/L anchors per token are taken from the original hex values
 * (e.g. --rh-text #dcfbe6 ≈ hsl(139, 79%, 92%)). A near-achromatic accent
 * (gray/minimal themes) degrades to a "white phosphor" tube: same lightness
 * ladder at a fraction of the saturation.
 *
 * Light: a paper-terminal variant ── dark ink (tinted with the same host hue)
 * on warm paper, phosphor glows replaced with soft paper shadows, semantic
 * colors darkened to ink weights that hold contrast on a light ground.
 */
export function derivePalette(accent: Hsl, kind: ThemeKind): Record<string, string> {
  const chromatic = accent.s >= 12
  const H = chromatic ? accent.h : 0
  // saturation multiplier: white-phosphor fallback keeps a whisper of tint
  const k = chromatic ? 1 : 0.12

  if (kind === "light") {
    const aH = chromatic ? accentHue(H) : AMBER_HUE
    const paperShadow = "0 1px 2px rgba(30, 25, 15, 0.1), 0 3px 10px rgba(30, 25, 15, 0.08)"
    return {
      "--rh-void": hsl(H, 18 * k, 90),
      "--rh-surface": hsl(H, 16 * k, 86),
      "--rh-surface-raised": hsl(H, 24 * k, 96),
      "--rh-card-bg": hsl(H, 26 * k, 97), // paper cards sit lighter than the page
      "--rh-border": hsl(H, 12 * k, 72),
      "--rh-border-bright": hsl(H, 14 * k, 60),
      "--rh-text": hsl(H, 60 * k, 15),
      "--rh-text-dim": hsl(H, 16 * k, 34),
      "--rh-text-muted": hsl(H, 10 * k, 48),
      "--rh-accent": hsl(aH, 100, 29),
      "--rh-accent-rgb": rgbTriplet(aH, 100, 29),
      "--rh-accent-soft": `hsla(${Math.round(aH)}, 100%, 29%, 0.14)`,
      "--rh-on-accent": hsl(aH, 100, 96),
      "--rh-success": hsl(140, 72, 26),
      "--rh-success-rgb": rgbTriplet(140, 72, 26),
      "--rh-success-light": hsl(140, 55, 88),
      "--rh-on-success": hsl(140, 70, 95),
      "--rh-danger": hsl(0, 62, 42),
      "--rh-danger-rgb": rgbTriplet(0, 62, 42),
      "--rh-info": hsl(193, 85, 30),
      "--rh-info-rgb": rgbTriplet(193, 85, 30),
      // phosphor bloom → flat paper shadows; text glow off entirely
      "--rh-shadow-card": paperShadow,
      "--rh-shadow-card-hover": "0 2px 4px rgba(30, 25, 15, 0.12), 0 6px 18px rgba(30, 25, 15, 0.12)",
      "--rh-glow-success": paperShadow,
      "--rh-glow-danger": paperShadow,
      "--rh-glow-text": "none",
      "--rh-glow-text-strong": "none",
      // CRT dressing, dialed down for paper: faint grain lines, white glass
      // glare, gentle vignette
      "--rh-scanline": "rgba(0, 0, 0, 0.028)",
      "--rh-glare-1": "rgba(255, 255, 255, 0.15)",
      "--rh-glare-2": "rgba(255, 255, 255, 0.12)",
      "--rh-vig-1": "rgba(0, 0, 0, 0.03)",
      "--rh-vig-2": "rgba(0, 0, 0, 0.07)",
      "--rh-vig-3": "rgba(0, 0, 0, 0.14)",
    }
  }

  const aH = accentHue(chromatic ? H : AMBER_HUE)
  const amberish = !chromatic || aH === AMBER_HUE
  return {
    "--rh-void": hsl(H, 25 * k, 3),
    "--rh-surface": hsl(H, 20 * k, 5),
    "--rh-surface-raised": hsl(H, 16 * k, 7.5),
    "--rh-card-bg": hsl(H, 16 * k, 6.5), // ≈ color-mix(surface-raised, black 14%)
    "--rh-border": hsl(H, 18 * k, 14),
    "--rh-border-bright": hsl(H, 21 * k, 22),
    "--rh-text": hsl(H, 79 * k, 92),
    "--rh-text-dim": hsl(H, 15 * k, 59),
    "--rh-text-muted": hsl(H, 12 * k, 41),
    "--rh-accent": amberish ? "#ffb703" : hsl(aH, 100, 60),
    "--rh-accent-rgb": amberish ? "255, 183, 3" : rgbTriplet(aH, 100, 60),
    "--rh-accent-soft": amberish ? "rgba(255, 183, 3, 0.12)" : `hsla(${Math.round(((aH % 360) + 360) % 360)}, 100%, 60%, 0.12)`,
    "--rh-on-accent": hsl(aH, 100, 8),
    // semantic colors stay fixed ── lines added must always read green,
    // deleted red, whatever the phosphor tint
    "--rh-success": "#39ff6a",
    "--rh-success-rgb": "57, 255, 106",
    "--rh-success-light": "#8effab",
    "--rh-on-success": "#06210e",
    "--rh-danger": "#ff5c5c",
    "--rh-danger-rgb": "255, 92, 92",
    "--rh-info": hsl(H + 54, 100 * Math.max(k, 0.6), 65),
    "--rh-info-rgb": rgbTriplet(H + 54, 100 * Math.max(k, 0.6), 65),
    // shadows/glows are defined in style.css from the --rh-*-rgb tokens above,
    // so they re-tint automatically ── only the CRT dressing needs values here
    "--rh-scanline": "rgba(0, 0, 0, 0.05)",
    "--rh-glare-1": `hsla(${Math.round(H)}, ${Math.round(79 * k)}%, 92%, 0.04)`,
    "--rh-glare-2": `hsla(${Math.round(H)}, ${Math.round(79 * k)}%, 92%, 0.045)`,
    "--rh-vig-1": "rgba(0, 0, 0, 0.1)",
    "--rh-vig-2": "rgba(0, 0, 0, 0.28)",
    "--rh-vig-3": "rgba(0, 0, 0, 0.55)",
  }
}

// Every key applyDerivedTheme may set inline ── all are cleared before each
// apply so a light→dark switch doesn't leave stale light-mode overrides on
// tokens the dark branch leaves to the stylesheet (shadows, glows).
const MANAGED_KEYS = [
  "--rh-void", "--rh-surface", "--rh-surface-raised", "--rh-card-bg",
  "--rh-border", "--rh-border-bright",
  "--rh-text", "--rh-text-dim", "--rh-text-muted",
  "--rh-accent", "--rh-accent-rgb", "--rh-accent-soft", "--rh-on-accent",
  "--rh-success", "--rh-success-rgb", "--rh-success-light", "--rh-on-success",
  "--rh-danger", "--rh-danger-rgb", "--rh-info", "--rh-info-rgb",
  "--rh-shadow-card", "--rh-shadow-card-hover",
  "--rh-glow-success", "--rh-glow-danger",
  "--rh-glow-text", "--rh-glow-text-strong",
  "--rh-scanline", "--rh-glare-1", "--rh-glare-2",
  "--rh-vig-1", "--rh-vig-2", "--rh-vig-3",
]

// Host theme colors to try as the hue source, most identity-bearing first.
const ACCENT_SOURCES = [
  "--vscode-focusBorder",
  "--vscode-activityBarBadge-background",
  "--vscode-button-background",
  "--vscode-textLink-foreground",
]

function themeKind(): ThemeKind {
  const kind = document.body.dataset.vscodeThemeKind
  if (kind) return kind.includes("light") ? "light" : "dark"
  return document.body.classList.contains("vscode-light") ? "light" : "dark"
}

/**
 * Read the host theme from the webview's --vscode-* vars and apply the
 * derived --rh-* palette inline on <html>. Returns a signature string that
 * changes when the applied palette changes ── callers compare it across
 * theme-change events to decide whether charts need a repaint.
 */
export function applyDerivedTheme(): string {
  const style = getComputedStyle(document.body)
  const kind = themeKind()

  let accent: Hsl | null = null
  for (const source of ACCENT_SOURCES) {
    const parsed = parseColor(style.getPropertyValue(source))
    // prefer the first *chromatic* source; remember the first parseable one
    // as a fallback so gray-accent themes still get the white-phosphor route
    if (parsed && !accent) accent = parsed
    if (parsed && parsed.s >= 12) { accent = parsed; break }
  }

  const root = document.documentElement
  for (const key of MANAGED_KEYS) root.style.removeProperty(key)
  if (!accent) return "static" // stylesheet defaults (green phosphor)

  const palette = derivePalette(accent, kind)
  for (const [key, value] of Object.entries(palette)) root.style.setProperty(key, value)
  return `${kind}:${Math.round(accent.h)}:${accent.s >= 12 ? "c" : "a"}`
}

/**
 * Re-apply the palette whenever VS Code swaps the theme (it rewrites the
 * body's class/attributes in place). Calls onChange only when the derived
 * palette actually changed ── canvas/SVG renderers repaint from there.
 */
export function watchThemeChanges(onChange: () => void): void {
  let signature = applyDerivedTheme()
  const observer = new MutationObserver(() => {
    const next = applyDerivedTheme()
    if (next !== signature) {
      signature = next
      onChange()
    }
  })
  // VS Code stamps the theme id/kind onto <body> on every theme switch ──
  // including dark→dark switches where the class list doesn't change.
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-vscode-theme-kind", "data-vscode-theme-id", "data-vscode-theme-name"],
  })
}
