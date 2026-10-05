// The status bar item: all projects' active time today against the global
// target. $(rabbithole-carrot) is the carrot from the icon font that phase 5
// registers; until then VS Code draws it as an empty glyph. Pure: no vscode.

// Floored: the status bar must never claim a minute that hasn't happened yet.
const dur = (ms: number): string => {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${m}m`
}

export function statusText(activeMs: number, targetMs: number): string {
  return `$(rabbithole-carrot) ${dur(activeMs)} / ${dur(targetMs)}`
}
