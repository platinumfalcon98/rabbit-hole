// Text and date formatting shared by every panel. Pure: no DOM, no vscode.
import { dayKey } from "./model"

export const MIN = 60_000
export const HOUR = 60 * MIN
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const pad2 = (n: number): string => String(n).padStart(2, "0")

// A "YYYY-MM-DD" key as a local date. new Date("YYYY-MM-DD") parses as UTC,
// which is the previous day everywhere west of Greenwich.
export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export function addDaysKey(key: string, n: number): string {
  const d = fromKey(key)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}

// Whole days from a to b, counted on UTC midnights so a 23- or 25-hour DST day is still one day.
export function dayDiff(a: string, b: string): number {
  const utc = (k: string) => {
    const [y, m, d] = k.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(b) - utc(a)) / 86_400_000)
}

// 0m, <1m, 45m, 1h05m, 3h40m
export function fmt(ms: number): string {
  if (ms <= 0) return "0m"
  const m = Math.round(ms / MIN)
  if (m === 0) return "<1m"
  return m >= 60 ? `${Math.floor(m / 60)}h${pad2(m % 60)}m` : `${m}m`
}

// Past ten hours the minutes are noise.
export const hours = (ms: number): string => (ms >= 10 * HOUR ? `${Math.round(ms / HOUR)}h` : fmt(ms))

// Minutes since midnight as HH:MM, rounded first so 59.6 is 01:00, never 00:60.
export function hhmm(minutes: number): string {
  const m = Math.round(minutes)
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

export function clock(unixMs: number): string {
  const d = new Date(unixMs)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function dstr(key: string): string {
  const d = fromKey(key)
  return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`
}

export function shortDate(key: string): string {
  const d = fromKey(key)
  return `${d.getDate()} ${MON[d.getMonth()]}`
}

export const weekday = (key: string): string => WD[fromKey(key).getDay()]
export const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`)
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`
export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round(part / whole * 100) : 0)

export function ago(then: number | undefined, now: number): string {
  if (then === undefined) return "never"
  const m = Math.floor((now - then) / MIN)
  if (m < 1) return "just now"
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${plural(Math.floor(h / 24), "day")} ago`
}

// A recorded (absolute) file path as git would show it: relative to the project
// when it is inside it, otherwise its last three segments.
export function splitPath(path: string, root: string | undefined): { dir: string; name: string } {
  const p = path.replace(/\\/g, "/")
  const r = (root ?? "").replace(/\\/g, "/").replace(/\/+$/, "")
  const rel = r && p.toLowerCase().startsWith(r.toLowerCase() + "/")
    ? p.slice(r.length + 1)
    : p.split("/").filter(Boolean).slice(-3).join("/")
  const i = rel.lastIndexOf("/")
  return i < 0 ? { dir: "", name: rel } : { dir: rel.slice(0, i + 1), name: rel.slice(i + 1) }
}
