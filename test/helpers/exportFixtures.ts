// Payloads for the export suites and the browser harnesses: a 365-day year
// ending on Monday 2026-10-05 (so it starts on a Monday, as the host's does)
// and range logs for the last 90 days, built from a compact description.
export const MIN = 60_000
export const TODAY = "2026-10-05"

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

export interface DaySpec {
  ms: number
  langs?: Record<string, [number, number, number]>                     // name -> [time ms, added, deleted]
  files?: [string, number, number][]                                  // [absolute path, added, deleted]
  sessions?: [number, number, number, Record<string, number>?][]      // [start minute of day, span min, active min, languages]
}

export function dayLog(date: string, spec: DaySpec): any {
  return {
    date,
    totalTime: spec.ms,
    activeTime: spec.ms,
    streak: 0,
    languages: Object.fromEntries(Object.entries(spec.langs ?? {}).map(([l, [t, a, d]]) => [l, { time: t, linesAdded: a, linesDeleted: d }])),
    agents: {},
    files: (spec.files ?? []).map(([path, a, d]) => ({ path, language: "typescript", linesAdded: a, linesDeleted: d, lastModified: 0 })),
    sessions: (spec.sessions ?? []).map(([startMin, span, active, languages], i) => {
      const start = at(date, 0, startMin)
      return {
        id: `${date}-${i}`, startTime: start, endTime: start + span * MIN, duration: span * MIN,
        activeTime: active * MIN, languages, intervals: [[start, start + span * MIN]],
      }
    }),
  }
}

export interface WorldOpts {
  targetMin?: number
  stamped?: Record<string, number>   // date -> global target minutes stamped on that day
  globalStreak?: number
  streaks?: Record<string, number>
  names?: Record<string, string>
  ids?: string[]                     // registered projects; defaults to the spec's keys
}

// Every registered project gets a log for every one of the last 90 days, as
// the host's range reply does.
export function world(spec: Record<string, Record<string, DaySpec>>, opts: WorldOpts = {}): { year: any; range: any } {
  const ids = opts.ids ?? Object.keys(spec)
  const days = Array.from({ length: 365 }, (_, i) => addDays(TODAY, i - 364))
  const active = (id: string, d: string) => spec[id]?.[d]?.ms ?? 0
  const year = {
    today: TODAY,
    days,
    globalTargetMs: (opts.targetMin ?? 20) * MIN,
    global: {
      streak: opts.globalStreak ?? 0,
      active: days.map(d => ids.reduce((n, id) => n + active(id, d), 0)),
      targetMs: days.map(d => (opts.stamped?.[d] !== undefined ? opts.stamped[d] * MIN : null)),
    },
    projects: ids.map(id => ({
      id, name: opts.names?.[id] ?? id, path: `/work/${id}`, streak: opts.streaks?.[id] ?? 0,
      active: days.map(d => active(id, d)), targetMs: days.map(() => null),
    })),
  }
  const from = addDays(TODAY, -89)
  const range = {
    from,
    to: TODAY,
    logs: Object.fromEntries(ids.map(id => [id, days.filter(d => d >= from).map(d => dayLog(d, spec[id]?.[d] ?? { ms: 0 }))])),
  }
  return { year, range }
}

// A plausible quarter for the harnesses: today matches the mockup's sessions.
export function sampleWorld(): { year: any; range: any } {
  let seed = 4242
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const rh: Record<string, DaySpec> = {}
  const cli: Record<string, DaySpec> = {}
  for (let i = 1; i < 90; i++) {
    const d = addDays(TODAY, -i)
    if (rnd() < 0.25) continue
    const ms = Math.round(10 + rnd() * 220) * MIN
    rh[d] = {
      ms,
      langs: { typescript: [ms * 0.7, Math.round(rnd() * 300), Math.round(rnd() * 120)], markdown: [ms * 0.3, Math.round(rnd() * 60), Math.round(rnd() * 20)] },
      files: [["/work/rabbit-hole/src/tracker/lineLedger.ts", 40, 12], ["/work/rabbit-hole/CLAUDE.md", 12, 3]],
    }
    if (rnd() < 0.5) {
      cli[d] = { ms: Math.round(ms * 0.3), langs: { go: [Math.round(ms * 0.3), 30, 8] }, files: [["/work/rabbithole-cli/cmd/rabbithole/main.go", 30, 8]] }
    }
  }
  rh[TODAY] = {
    ms: 192 * MIN,
    langs: { typescript: [122 * MIN, 280, 110], markdown: [35 * MIN, 52, 9], css: [12 * MIN, 21, 12], json: [6 * MIN, 8, 2], go: [17 * MIN, 31, 8] },
    files: [
      ["/work/rabbit-hole/src/tracker/lineLedger.ts", 142, 61], ["/work/rabbit-hole/src/tracker/activityTracker.ts", 96, 58],
      ["/work/rabbit-hole/test/tracker.ledger.test.ts", 64, 14], ["/work/rabbit-hole/CLAUDE.md", 38, 6], ["/work/rabbit-hole/src/webview/style.css", 21, 12],
    ],
    sessions: [
      [8 * 60 + 41, 77, 64, { typescript: 45 * MIN, markdown: 13 * MIN, json: 6 * MIN }],
      [10 * 60 + 20, 105, 78, { typescript: 66 * MIN, css: 12 * MIN }],
      [14 * 60 + 2, 29, 22, { markdown: 22 * MIN }],
      [16 * 60 + 10, 48, 28, { go: 17 * MIN, typescript: 11 * MIN }],
    ],
  }
  cli[TODAY] = { ms: 28 * MIN, langs: { go: [21 * MIN, 31, 8], markdown: [7 * MIN, 4, 0] }, files: [["/work/rabbithole-cli/cmd/rabbithole/main.go", 31, 8]], sessions: [[17 * 60 + 18, 33, 28, { go: 21 * MIN, markdown: 7 * MIN }]] }
  return world({ "rabbit-hole": rh, "rabbithole-cli": cli }, { globalStreak: 12, streaks: { "rabbit-hole": 9, "rabbithole-cli": 2 } })
}
