// Makes the harness fixture agree with itself, the way real tracker data does.
// It is what the README screenshots show, so no number may contradict another:
// - every file is "typescript" in the fixture: take the language from the extension;
// - language line counts are independent random numbers: sum them from the files;
// - streaks are fixed constants: count the run of met days, as storage does;
// - last active is unset: take the latest session end, as the host does.
const EXT: Record<string, string> = { ts: "typescript", md: "markdown", css: "css", go: "go", json: "json" }

export function consistent(w: { year: any; range: any }): { year: any; range: any } {
  for (const logs of Object.values(w.range.logs) as any[][]) {
    for (const log of logs) {
      if (!log.files?.length) continue
      for (const l of Object.values(log.languages) as any[]) { l.linesAdded = 0; l.linesDeleted = 0 }
      for (const f of log.files) {
        f.language = EXT[f.path.slice(f.path.lastIndexOf(".") + 1)] ?? f.language
        const l = log.languages[f.language] ?? (log.languages[f.language] = { time: 0, linesAdded: 0, linesDeleted: 0 })
        l.linesAdded += f.linesAdded
        l.linesDeleted += f.linesDeleted
      }
    }
  }
  const target = w.year.globalTargetMs
  // Today met: the run ends today; not yet: it ends yesterday ("at risk").
  const run = (active: number[]) => {
    let i = active.length - 1
    if (active[i] < target) i--
    let n = 0
    for (; i >= 0 && active[i] >= target; i--) n++
    return n
  }
  w.year.global.streak = run(w.year.global.active)
  for (const p of w.year.projects) p.streak = run(p.active)
  // The fixture leaves lastActive unset ("never"); the host takes the latest
  // session end in the year (payloads.ts buildYear).
  for (const p of w.year.projects) {
    for (const log of w.range.logs[p.id] ?? []) {
      for (const s of log.sessions ?? []) {
        const t = s.endTime ?? s.startTime
        if (p.lastActive === undefined || t > p.lastActive) p.lastActive = t
      }
    }
  }
  return w
}
