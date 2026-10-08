import { test } from "node:test"
import assert from "node:assert/strict"
import { AGENT_LINES, agentLive, rescueLive } from "../src/data/agentLive"
import { AGENT_SCENE, AT_RISK_PROJECT, MIN, showcase } from "../src/data/showcase"

const s = showcase()
const times = (t: number) => Object.fromEntries(Object.entries(agentLive(t).log.languages).map(([k, v]) => [k, v.time]))
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

test("the agent shift starts at AGENT_SCENE.before, ends on the stored data, never adds time", () => {
  assert.deepEqual(times(0), AGENT_SCENE.before)
  assert.deepEqual(agentLive(1), s.live)
  for (let t = 0; t <= 1; t += 0.05) assert.equal(sum(times(t)), sum(AGENT_SCENE.after))
})
test("before the span resolves, Go has the agent's lines taken off, never below zero", () => {
  const go0 = agentLive(0).log.languages.go, go1 = s.live.log.languages.go
  assert.equal(go1.linesAdded - go0.linesAdded, AGENT_LINES.added)
  assert.equal(go1.linesDeleted - go0.linesDeleted, AGENT_LINES.deleted)
  assert.ok(go0.linesAdded >= 0 && go0.linesDeleted >= 0)
})
test("the rescue meets the at-risk project's target and extends its streak by one", () => {
  const r = rescueLive()
  assert.ok(r.todayActive[AT_RISK_PROJECT] >= 20 * MIN)
  assert.equal(r.streaks[AT_RISK_PROJECT], s.live.streaks[AT_RISK_PROJECT] + 1)
  assert.equal(r.log.activeTime, r.log.sessions.reduce((a, x) => a + x.activeTime, 0))
  assert.equal(r.globalToday, s.live.globalToday + r.todayActive[AT_RISK_PROJECT])
})
