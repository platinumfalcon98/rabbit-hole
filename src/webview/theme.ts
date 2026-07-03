// Shared design-token accessors for charts.ts and heatmap.ts.
// Keeps the "read the palette once, from one place" promise in DESIGN.md —
// both chart renderers read the same --rh-* custom properties defined in
// style.css's :root block instead of each maintaining its own copy.

// getComputedStyle() allocates a live CSSStyleDeclaration on every call, and
// a single chart render can read 6-8 tokens (see projectColors()). Cache the
// declaration for the duration of one synchronous render burst and drop it
// on the next microtask so later renders still see up-to-date values.
let cachedStyle: CSSStyleDeclaration | null = null
function bodyStyle(): CSSStyleDeclaration {
  if (!cachedStyle) {
    cachedStyle = getComputedStyle(document.body)
    queueMicrotask(() => { cachedStyle = null })
  }
  return cachedStyle
}

export function getCssVar(name: string, fallback: string): string {
  const val = bodyStyle().getPropertyValue(name).trim()
  return val || fallback
}

export const accentColor = () => getCssVar("--rh-accent", "#ffb703")
export const successColor = () => getCssVar("--rh-success", "#39ff6a")
export const dangerColor = () => getCssVar("--rh-danger", "#ff5c5c")
export const infoColor = () => getCssVar("--rh-info", "#4fd8ff")
export const textColor = () => getCssVar("--rh-text", "#dcfbe6")
export const textDimColor = () => getCssVar("--rh-text-dim", "#86a596")
export const textMutedColor = () => getCssVar("--rh-text-muted", "#5b7468")
export const surfaceRaisedColor = () => getCssVar("--rh-surface-raised", "#101613")

export const accentRgb = () => getCssVar("--rh-accent-rgb", "255, 183, 3")
export const successRgb = () => getCssVar("--rh-success-rgb", "57, 255, 106")
export const dangerRgb = () => getCssVar("--rh-danger-rgb", "255, 92, 92")
export const infoRgb = () => getCssVar("--rh-info-rgb", "79, 216, 255")

// Chart.js/SVG can't resolve CSS var() in font.family, so these are literal
// strings — must stay in sync with --rh-font-mono / --rh-font-label in style.css.
export const CHART_FONT_MONO = "'VT323', monospace"
export const CHART_FONT_LABEL = "'Electrolize', sans-serif"
