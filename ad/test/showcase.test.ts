import { test } from "node:test"
import assert from "node:assert/strict"
import { showcase, PROJECTS, AGENT_SCENE, TODAY, NOW, MIN, HERO_PROJECT, AT_RISK_PROJECT } from "../src/data/showcase"

const s = showcase()
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

test("rabbithole-cli is a project, among 4–5", () => {
  assert.ok(PROJECTS.some(p => p.name === "rabbithole-cli"))
  assert.ok(PROJECTS.length >= 4 && PROJECTS.length <= 5)
  assert.deepEqual(s.year.projects.map(p => p.id), PROJECTS.map(p => p.id))
})
test("the year ends today and is Monday-aligned", () => {
  assert.equal(s.year.today, TODAY)
  assert.equal(s.year.days.at(-1), TODAY)
  assert.equal(new Date(s.year.days[0] + "T12:00").getDay(), 1)
  assert.ok(s.year.days.length >= 365 && s.year.days.length <= 371)
})
test("global active is the sum of the projects every day", () => {
  s.year.days.forEach((_, i) => assert.equal(s.year.global.active[i], s.year.projects.reduce((a, p) => a + p.active[i], 0)))
})
test("every range log's language times sum to its sessions' language times, and sessions to the day", () => {
  for (const logs of Object.values(s.range.logs)) for (const log of logs) {
    const lang = Object.values(log.languages).reduce((a, l) => a + l.time, 0)
    const sess = log.sessions.reduce((a, x) => a + Object.values(x.languages ?? {}).reduce((b, v) => b + v, 0), 0)
    assert.equal(lang, sess)
    assert.equal(log.activeTime, log.sessions.reduce((a, x) => a + x.activeTime, 0))
    for (const x of log.sessions) assert.equal(sum(x.languages ?? {}), x.activeTime)
    for (const [name, l] of Object.entries(log.languages)) {
      const files = log.files.filter(f => f.language === name)
      assert.equal(l.linesAdded, files.reduce((a, f) => a + f.linesAdded, 0))
    }
  }
})
test("range logs agree with the year's per-day active, over the last 92 days", () => {
  assert.equal(s.range.to, TODAY)
  for (const p of s.year.projects) {
    assert.equal(s.range.logs[p.id].length, 92)
    for (const log of s.range.logs[p.id]) assert.equal(log.activeTime, p.active[s.year.days.indexOf(log.date)])
  }
})
test("sessions never overlap across projects on a day", () => {
  for (let d = 0; d < 92; d++) {
    const ss = Object.values(s.range.logs).flatMap(l => l[d].sessions).sort((a, b) => a.startTime - b.startTime)
    for (let i = 1; i < ss.length; i++) assert.ok(ss[i].startTime >= ss[i - 1].endTime!)
  }
})
test("today is the hero day: 3h40m against a 20-minute target, met at 14:32, before NOW", () => {
  const today = s.year.global.active.at(-1)!
  assert.equal(today, 220 * MIN)
  assert.ok(today >= 3.6 * 3.6e6 && today < 3.75 * 3.6e6)
  assert.equal(s.year.globalTargetMs, 20 * MIN)
  const ss = Object.values(s.range.logs).flatMap(l => l.at(-1)!.sessions).sort((a, b) => a.startTime - b.startTime)
  const first = ss[0]
  const metAt = first.startTime + (20 * MIN) / first.activeTime * (first.endTime! - first.startTime)
  const d = new Date(metAt)
  assert.equal(`${d.getHours()}:${d.getMinutes()}`, "14:32")
  assert.ok(ss.at(-1)!.endTime! <= NOW)
})
test("streaks follow from the targets: global in the low double digits, one project at risk", () => {
  const met = (a: number[], i: number) => a[i] >= 20 * MIN
  const run = (a: number[], end: number) => { let n = 0; for (let i = end; i >= 0 && met(a, i); i--) n++; return n }
  const last = s.year.days.length - 1
  assert.equal(s.year.global.streak, run(s.year.global.active, last))
  assert.ok(s.year.global.streak >= 10 && s.year.global.streak <= 15)
  for (const p of s.year.projects) {
    const expect = met(p.active, last) ? run(p.active, last) : run(p.active, last - 1)
    assert.equal(p.streak, expect, p.name)
    assert.equal(s.live.streaks[p.id], p.streak)
  }
  const risk = s.year.projects.find(p => p.id === AT_RISK_PROJECT)!
  assert.ok(risk.streak > 0 && risk.active[last] < 20 * MIN)
})
test("live, mini and settings agree with the year", () => {
  assert.equal(s.live.today, TODAY)
  assert.equal(s.live.projectId, HERO_PROJECT)
  assert.equal(s.live.globalToday, s.year.global.active.at(-1))
  assert.deepEqual(s.live.log, s.range.logs[HERO_PROJECT].at(-1))
  for (const p of s.year.projects) {
    assert.equal(s.live.todayActive[p.id], p.active.at(-1))
    assert.deepEqual(s.mini.logs[p.id], s.range.logs[p.id].at(-1))
  }
  assert.equal(s.settings.type, "settings")
  assert.equal(s.settings.dailyTargetMinutes, 20)
})
test("the agent scene only moves time, never adds it, and ends where the data does", () => {
  assert.equal(sum(AGENT_SCENE.before), sum(AGENT_SCENE.after))
  assert.ok((AGENT_SCENE.after.go ?? 0) > (AGENT_SCENE.before.go ?? 0))
  assert.ok((AGENT_SCENE.after.markdown ?? 0) < (AGENT_SCENE.before.markdown ?? 0))
  const hero = s.range.logs[HERO_PROJECT].at(-1)!
  assert.deepEqual(Object.fromEntries(Object.entries(hero.languages).map(([k, v]) => [k, v.time])), AGENT_SCENE.after)
})
test("deterministic", () => assert.deepEqual(showcase(), s))
