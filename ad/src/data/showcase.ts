// The invented dataset the film shows, in the extension's own message shapes,
// so the real dashboard modules can render it. Every number is generated from
// a seeded PRNG (never Math.random) and is internally consistent: global days
// are the sum of the projects, languages sum to sessions, sessions to the day,
// streaks follow from the 20-minute target.
import type { ActivitySession, CrtSettings, DailyLog, ExtensionMessage, FileActivity, LivePayload, MiniPayload, ProjectYear, RangePayload, YearPayload } from "../../../src/shared/types"

export const MIN = 60_000
export const TODAY = "2026-10-12"   // a Monday
const TARGET_MIN = 20
const HOME = "/home/sam/code"

export const PROJECTS: { id: string; name: string }[] = [
  { id: "https://github.com/samvoss/orbit-ui.git", name: "orbit-ui" },
  { id: "https://github.com/rabbithole/rabbithole-cli.git", name: "rabbithole-cli" },
  { id: "https://github.com/samvoss/tidepool.git", name: "tidepool" },
  { id: "https://github.com/samvoss/quill-api.git", name: "quill-api" },
  { id: "folder:dotfiles:3f9c2a", name: "dotfiles" },
]
const [ORBIT, CLI, TIDE, QUILL, DOTS] = PROJECTS.map(p => p.id)
export const HERO_PROJECT = CLI        // the window's current project; the agent scene's
export const AT_RISK_PROJECT = QUILL

export const CRT: CrtSettings = { mask: "grille", pitch: "fine", strength: 34, vignette: 35, effects: ["scanlines", "bloom", "flicker"] }

// Languages per project, with their share of the time and the files they touch.
const LANGS: Record<string, { lang: string; w: number; files: string[] }[]> = {
  [ORBIT]: [
    { lang: "typescript", w: 0.66, files: ["src/components/Timeline.tsx", "src/hooks/useOrbit.ts", "src/store/session.ts", "src/api/client.ts", "test/timeline.test.ts"] },
    { lang: "css", w: 0.24, files: ["src/styles/timeline.css", "src/styles/tokens.css"] },
    { lang: "json", w: 0.1, files: ["package.json", "tsconfig.json"] },
  ],
  [CLI]: [
    { lang: "go", w: 0.68, files: ["cmd/rabbithole/main.go", "internal/mirror/read.go", "internal/report/week.go", "internal/report/streak.go", "internal/mirror/read_test.go"] },
    { lang: "markdown", w: 0.32, files: ["README.md", "docs/install.md"] },
  ],
  [TIDE]: [
    { lang: "rust", w: 0.84, files: ["src/engine/flow.rs", "src/engine/grid.rs", "src/main.rs", "benches/flow.rs"] },
    { lang: "toml", w: 0.16, files: ["Cargo.toml"] },
  ],
  [QUILL]: [
    { lang: "python", w: 0.8, files: ["quill/routes/notes.py", "quill/models.py", "quill/search.py", "tests/test_search.py"] },
    { lang: "yaml", w: 0.2, files: ["deploy/compose.yaml", ".github/workflows/ci.yaml"] },
  ],
  [DOTS]: [
    { lang: "shellscript", w: 0.55, files: ["bin/sync.sh", "install.sh"] },
    { lang: "lua", w: 0.45, files: ["nvim/init.lua", "nvim/lua/keys.lua"] },
  ],
}
const WEIGHT: Record<string, number> = { [ORBIT]: 0.34, [CLI]: 0.27, [TIDE]: 0.19, [QUILL]: 0.13, [DOTS]: 0.07 }

// ── dates (local time, like the extension's day keys) ──
const key = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number)
  return key(new Date(y, m - 1, d + n))
}
export function at(day: string, h: number, m = 0): number {
  const [y, mo, d] = day.split("-").map(Number)
  return new Date(y, mo - 1, d, h, m).getTime()
}
const weekdayOf = (day: string): number => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d).getDay() }

/** The moment the film's dashboard thinks it is: today, 21:10. */
export const NOW = at(TODAY, 21, 10)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── the year's active minutes per project per day ──
const YEAR_START = (() => {
  const d = addDays(TODAY, -364)
  return addDays(d, -((weekdayOf(d) + 6) % 7))
})()
const DAYS: string[] = (() => {
  const out: string[] = []
  for (let d = YEAR_START; d <= TODAY; d = addDays(d, 1)) out.push(d)
  return out
})()
const RANGE_FROM = addDays(TODAY, -91)

const VACATION: [string, string][] = [["2025-12-22", "2026-01-04"], ["2026-07-20", "2026-07-31"], ["2026-04-03", "2026-04-06"]]
const onVacation = (d: string) => VACATION.some(([a, b]) => d >= a && d <= b)

// Minutes per project per day. Fixed days (the last two weeks, today) override.
function yearMinutes(): Record<string, number[]> {
  const rnd = mulberry32(20261012)
  const out: Record<string, number[]> = Object.fromEntries(PROJECTS.map(p => [p.id, DAYS.map(() => 0)]))
  DAYS.forEach((d, i) => {
    const wd = weekdayOf(d)
    const growth = 0.7 + 0.45 * (i / DAYS.length)            // the habit grows over the year
    let total = 0
    if (onVacation(d)) total = rnd() < 0.15 ? 15 + rnd() * 25 : 0
    else if (wd === 0) total = rnd() < 0.45 ? 0 : 20 + rnd() * 70
    else if (wd === 6) total = rnd() < 0.25 ? 0 : 35 + rnd() * 110
    else total = rnd() < 0.05 ? 0 : (70 + rnd() * 190) * growth
    total = Math.round(total)
    if (total <= 0) return
    // one to three projects that day, by weight
    const n = total < 60 ? 1 : total < 150 ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2)
    const picked: string[] = []
    while (picked.length < n) {
      let r = rnd() * PROJECTS.reduce((a, p) => a + (picked.includes(p.id) ? 0 : WEIGHT[p.id]), 0)
      for (const p of PROJECTS) {
        if (picked.includes(p.id)) continue
        r -= WEIGHT[p.id]
        if (r <= 0) { picked.push(p.id); break }
      }
    }
    const shares = picked.map(() => 0.4 + rnd())
    const sumS = shares.reduce((a, b) => a + b, 0)
    let left = total
    picked.forEach((id, k) => {
      const m = k === picked.length - 1 ? left : Math.max(8, Math.round(total * shares[k] / sumS))
      out[id][i] = Math.min(m, left)
      left -= out[id][i]
    })
  })
  // The recent fortnight, fixed so the streaks read well:
  // global met on the last 12 days (incl. today), missed 13 days ago;
  // quill-api met on the 6 days before today, nothing today: at risk.
  const last = DAYS.length - 1
  const fixed: Record<number, Record<string, number>> = {
    [last - 12]: {},
    [last - 11]: { [ORBIT]: 64, [CLI]: 31 },
    [last - 10]: { [ORBIT]: 92, [TIDE]: 48, [CLI]: 28 },
    [last - 9]: { [CLI]: 46, [DOTS]: 22 },
    [last - 8]: { [TIDE]: 38, [CLI]: 24 },
    [last - 7]: { [ORBIT]: 118, [CLI]: 72, [TIDE]: 25 },
    [last - 6]: { [ORBIT]: 84, [QUILL]: 41, [CLI]: 36 },
    [last - 5]: { [CLI]: 128, [QUILL]: 33 },
    [last - 4]: { [ORBIT]: 141, [QUILL]: 27, [TIDE]: 52, [CLI]: 31 },
    [last - 3]: { [ORBIT]: 77, [QUILL]: 58, [CLI]: 49 },
    [last - 2]: { [TIDE]: 66, [QUILL]: 24, [CLI]: 35, [ORBIT]: 40 },
    [last - 1]: { [CLI]: 152, [QUILL]: 36, [ORBIT]: 58 },
    [last]: { [ORBIT]: 96, [CLI]: 82, [TIDE]: 42 },
  }
  for (const [i, row] of Object.entries(fixed)) for (const p of PROJECTS) out[p.id][Number(i)] = row[p.id] ?? 0
  return out
}

// ── one project's detailed log for a day ──
// Hero-day sessions: start minute, span minutes, active minutes, languages (minutes).
const HERO: Record<string, [number, number, number, Record<string, number>][]> = {
  [ORBIT]: [[14 * 60 + 7, 120, 96, { typescript: 70, css: 26 }]],
  [CLI]: [[16 * 60 + 25, 115, 82, { go: 64, markdown: 18 }]],
  [TIDE]: [[19 * 60 + 5, 85, 42, { rust: 36, toml: 6 }]],
}
/** The hero project's language minutes for today, before and after the agent span resolves. */
export const AGENT_SCENE: { before: Record<string, number>; after: Record<string, number> } = {
  before: { go: 42 * MIN, markdown: 40 * MIN },   // go keeps the first colour throughout (paints rank by time)
  after: { go: 64 * MIN, markdown: 18 * MIN },
}

const emptyAgents = (): DailyLog["agents"] => ({ "claude-code": [], copilot: [], cursor: [], continue: [], "unknown-ai": [], manual: [] })

function splitMinutes(total: number, langs: { lang: string; w: number }[], rnd: () => number): Record<string, number> {
  const w = langs.map(l => l.w * (0.7 + rnd() * 0.6))
  const sw = w.reduce((a, b) => a + b, 0)
  const out: Record<string, number> = {}
  let left = total
  langs.forEach((l, k) => {
    const m = k === langs.length - 1 ? left : Math.round(total * w[k] / sw)
    if (m > 0) out[l.lang] = Math.min(m, left)
    left -= Math.min(m, left)
  })
  return out
}

function filesFor(projectId: string, langMin: Record<string, number>, day: string, rnd: () => number): FileActivity[] {
  const files: FileActivity[] = []
  for (const l of LANGS[projectId]) {
    const m = langMin[l.lang] ?? 0
    if (!m) continue
    const k = Math.min(l.files.length, 1 + Math.floor(m / 25))
    const start = Math.floor(rnd() * l.files.length)
    for (let j = 0; j < k; j++) {
      const rel = l.files[(start + j) % l.files.length]
      const added = Math.max(1, Math.round(m * (0.6 + rnd() * 1.6) / k))
      const deleted = Math.round(added * (0.15 + rnd() * 0.5))
      files.push({ path: `${HOME}/${PROJECTS.find(p => p.id === projectId)!.name}/${rel}`, language: l.lang, linesAdded: added, linesDeleted: deleted, lastModified: at(day, 12) })
    }
  }
  return files.sort((a, b) => b.linesAdded + b.linesDeleted - (a.linesAdded + a.linesDeleted))
}

type SessionSpec = [number, number, number, Record<string, number>]   // start minute, span, active, languages (minutes)

function logFor(projectId: string, day: string, sessions: SessionSpec[], rnd: () => number): DailyLog {
  const ss: ActivitySession[] = sessions.map(([start, span, active, langs], k) => {
    const s = at(day, 0, start)
    return {
      id: `${day}-${PROJECTS.findIndex(p => p.id === projectId)}-${k}`,
      startTime: s,
      endTime: s + span * MIN,
      duration: span * MIN,
      activeTime: active * MIN,
      languages: Object.fromEntries(Object.entries(langs).map(([l, m]) => [l, m * MIN])),
      intervals: [[s, s + span * MIN]],
    }
  })
  const langMin: Record<string, number> = {}
  for (const [, , , langs] of sessions) for (const [l, m] of Object.entries(langs)) langMin[l] = (langMin[l] ?? 0) + m
  const files = filesFor(projectId, langMin, day, rnd)
  const languages: DailyLog["languages"] = {}
  for (const [l, m] of Object.entries(langMin)) {
    const fs = files.filter(f => f.language === l)
    languages[l] = { time: m * MIN, linesAdded: fs.reduce((a, f) => a + f.linesAdded, 0), linesDeleted: fs.reduce((a, f) => a + f.linesDeleted, 0) }
  }
  const activeTime = ss.reduce((a, s) => a + s.activeTime, 0)
  return {
    date: day,
    totalTime: ss.reduce((a, s) => a + s.duration, 0),
    activeTime,
    streak: 0,
    targetMs: TARGET_MIN * MIN,
    languages,
    agents: emptyAgents(),
    files,
    sessions: ss,
  }
}

// Lays a day's project chunks out one after another, so sessions never overlap.
function daySessions(day: string, minutes: Record<string, number>, rnd: () => number): Record<string, SessionSpec[]> {
  if (day === TODAY) return HERO
  const wd = weekdayOf(day)
  let t = (wd === 0 || wd === 6 ? 10 * 60 + 30 : 8 * 60 + 20) + Math.floor(rnd() * 90)
  const chunks: [string, number][] = []
  for (const p of PROJECTS) {
    const m = minutes[p.id] ?? 0
    if (!m) continue
    if (m > 80) { const a = Math.round(m * (0.4 + rnd() * 0.2)); chunks.push([p.id, a], [p.id, m - a]) }
    else chunks.push([p.id, m])
  }
  // interleave deterministically
  for (let i = chunks.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [chunks[i], chunks[j]] = [chunks[j], chunks[i]] }
  const out: Record<string, SessionSpec[]> = {}
  for (const [id, m] of chunks) {
    const span = Math.round(m * (1.08 + rnd() * 0.3))
    ;(out[id] ??= []).push([t, span, m, splitMinutes(m, LANGS[id], rnd)])
    t += span + 12 + Math.floor(rnd() * 50)
    if (t > 12 * 60 && t < 13 * 60) t += 45   // lunch
  }
  return out
}

function streakEndingAt(active: number[], end: number): number {
  let n = 0
  for (let i = end; i >= 0 && active[i] >= TARGET_MIN * MIN; i--) n++
  return n
}
const currentStreak = (active: number[]): number => {
  const last = active.length - 1
  return active[last] >= TARGET_MIN * MIN ? streakEndingAt(active, last) : streakEndingAt(active, last - 1)
}

export interface Showcase {
  year: YearPayload
  range: RangePayload
  live: LivePayload
  mini: MiniPayload
  settings: Extract<ExtensionMessage, { type: "settings" }>
}

export function showcase(): Showcase {
  const minutes = yearMinutes()
  const rnd = mulberry32(7)
  const logs: Record<string, DailyLog[]> = Object.fromEntries(PROJECTS.map(p => [p.id, []]))
  DAYS.forEach((d, i) => {
    if (d < RANGE_FROM) return
    const sessions = daySessions(d, Object.fromEntries(PROJECTS.map(p => [p.id, minutes[p.id][i]])), rnd)
    for (const p of PROJECTS) logs[p.id].push(logFor(p.id, d, sessions[p.id] ?? [], rnd))
  })
  // today's hero minutes come from HERO; keep the year in step with them
  const last = DAYS.length - 1
  for (const p of PROJECTS) minutes[p.id][last] = (HERO[p.id] ?? []).reduce((a, s) => a + s[2], 0)

  const active: Record<string, number[]> = Object.fromEntries(PROJECTS.map(p => [p.id, minutes[p.id].map(m => m * MIN)]))
  const globalActive = DAYS.map((_, i) => PROJECTS.reduce((a, p) => a + active[p.id][i], 0))
  const projects: ProjectYear[] = PROJECTS.map(p => {
    const ends = logs[p.id].flatMap(l => l.sessions.map(s => s.endTime ?? s.startTime))
    // before the range there are no sessions: the latest active day stands in
    let lastIdx = -1
    active[p.id].forEach((v, i) => { if (v > 0) lastIdx = i })
    return {
      id: p.id,
      name: p.name,
      path: `${HOME}/${p.name}`,
      streak: currentStreak(active[p.id]),
      lastActive: ends.length ? Math.max(...ends) : lastIdx >= 0 ? at(DAYS[lastIdx], 18) : undefined,
      active: active[p.id],
      targetMs: DAYS.map(() => TARGET_MIN * MIN),
    }
  })
  // per-project log streaks, as storage stamps them
  for (const p of projects) {
    for (const l of logs[p.id]) l.streak = streakEndingAt(p.active, DAYS.indexOf(l.date))
  }
  const year: YearPayload = {
    today: TODAY,
    days: DAYS,
    globalTargetMs: TARGET_MIN * MIN,
    global: { streak: currentStreak(globalActive), active: globalActive, targetMs: DAYS.map(() => TARGET_MIN * MIN) },
    projects,
  }
  const range: RangePayload = { from: RANGE_FROM, to: TODAY, logs }
  const todayLogs = Object.fromEntries(PROJECTS.map(p => [p.id, logs[p.id][logs[p.id].length - 1]]))
  const live: LivePayload = {
    today: TODAY,
    projectId: HERO_PROJECT,
    log: todayLogs[HERO_PROJECT],
    todayActive: Object.fromEntries(projects.map(p => [p.id, p.active[last]])),
    globalToday: globalActive[last],
    globalStreak: year.global.streak,
    streaks: Object.fromEntries(projects.map(p => [p.id, p.streak])),
  }
  return {
    year,
    range,
    live,
    mini: { year, logs: todayLogs },
    settings: {
      type: "settings", dailyTargetMs: TARGET_MIN * MIN, dailyTargetMinutes: TARGET_MIN, idleThresholdMinutes: 5,
      storagePath: "~/.config/Code/User/globalStorage/rabbit-hole.rabbit-hole", crt: CRT,
    },
  }
}
