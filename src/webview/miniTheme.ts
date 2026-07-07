// Mini panel theme bootstrap ── separate esbuild entry loaded by the
// Activity Bar webview (miniPanel.ts). Applies the host-derived --rh-*
// palette and notifies the panel's inline script when a theme switch
// changes it, so the SVG donut/sparkline redraw with the new colors.
import { watchThemeChanges } from "./derivePalette"

watchThemeChanges(() => window.dispatchEvent(new CustomEvent("rh-theme-changed")))
