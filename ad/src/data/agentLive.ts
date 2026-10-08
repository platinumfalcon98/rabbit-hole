// The live updates the agent and streak scenes send into the real dashboard,
// built from the showcase so every number stays consistent.
import type { LivePayload } from "../../../src/shared/types"
import { AGENT_SCENE, AT_RISK_PROJECT, HERO_PROJECT, MIN, NOW, showcase } from "./showcase"

const base = showcase()
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

/** Lines the agent wrote in Go during its span (the terminal shows the same). */
export const AGENT_LINES = { added: 60, deleted: 20 }

/** The hero project's today while the agent's held time resolves: t = 0 before, 1 after. */
export function agentLive(t: number): LivePayload {
  const live = clone(base.live)
  const k = Math.max(0, Math.min(1, t))
  const mins = (a: number, b: number) => Math.round((a + (b - a) * k) / MIN) * MIN
  const go = live.log.languages.go
  const md = live.log.languages.markdown
  go.time = mins(AGENT_SCENE.before.go, AGENT_SCENE.after.go)
  md.time = AGENT_SCENE.before.go + AGENT_SCENE.before.markdown - go.time   // only moved, never added
  go.linesAdded = Math.round(go.linesAdded - AGENT_LINES.added * (1 - k))
  go.linesDeleted = Math.max(0, Math.round(go.linesDeleted - AGENT_LINES.deleted * (1 - k)))
  for (const s of live.log.sessions) if (s.languages) { s.languages.go = go.time; s.languages.markdown = md.time }
  return live
}

/** The at-risk project after the mouse "works" on it: a 26-minute session, the streak back on track. */
export function rescueLive(): LivePayload {
  const live = clone(base.live)
  const id = AT_RISK_PROJECT
  const log = clone(base.range.logs[id][base.range.logs[id].length - 1])
  const start = NOW - 34 * MIN
  log.sessions = [{ id: "rescue", startTime: start, endTime: start + 30 * MIN, duration: 30 * MIN, activeTime: 26 * MIN, languages: { python: 26 * MIN }, intervals: [[start, start + 30 * MIN]] }]
  log.activeTime = 26 * MIN
  log.totalTime = 30 * MIN
  log.languages = { python: { time: 26 * MIN, linesAdded: 31, linesDeleted: 6 } }
  log.files = [{ path: "/home/sam/code/quill-api/quill/search.py", language: "python", linesAdded: 31, linesDeleted: 6, lastModified: start + 30 * MIN }]
  live.projectId = id
  live.log = log
  live.todayActive[id] = 26 * MIN
  live.globalToday += 26 * MIN
  live.streaks[id] = (base.live.streaks[id] ?? 0) + 1
  return live
}

export const HERO = HERO_PROJECT
