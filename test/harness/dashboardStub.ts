// A stand-in for VS Code's webview API that answers the dashboard from fixture
// data, and downloads any file the export dialog asks the host to save.
import { MIN, crowdedWorld, sampleWorld } from "../helpers/exportFixtures"
import { consistent } from "./showcase"

// ?many: more projects and languages than the palette has colours
const { year, range } = location.search.includes("many") ? crowdedWorld() : consistent(sampleWorld())
const settings = {
  type: "settings", dailyTargetMs: 20 * MIN, dailyTargetMinutes: 20, idleThresholdMinutes: 5, storagePath: "/harness",
  crt: { mask: "slot", pitch: "fine", strength: 23, vignette: 35, effects: ["scanlines", "bloom"] },
}
const send = (m: unknown) => setTimeout(() => window.postMessage(m, "*"), 30)

// what buildYear adds: languages ranked by time over the fixture's logs, and the picks
const langMs = new Map<string, number>()
for (const logs of Object.values(range.logs) as any[][]) {
  for (const l of logs) for (const [name, s] of Object.entries(l.languages ?? {}) as [string, any][]) langMs.set(name, (langMs.get(name) ?? 0) + s.time)
}
year.languages = [...langMs].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([n]) => n)
year.colors = { projects: {}, languages: {} }

;(window as any).acquireVsCodeApi = () => ({
  getState: () => null,
  setState: () => undefined,
  postMessage: (m: any) => {
    console.log("[harness] webview →", m.type, m)
    if (m.type === "ready") { send(settings); send({ type: "year", ...year }) }
    if (m.type === "requestYear") send({ type: "year", ...year })
    if (m.type === "setColor") {
      const key = m.kind === "project" ? "projects" : "languages"
      if (m.mark === null) delete year.colors[key][m.id]
      else year.colors[key][m.id] = m.mark
      send({ type: "year", ...year })
    }
    if (m.type === "requestDays") {
      const logs = Object.fromEntries(Object.entries(range.logs).map(([id, l]: [string, any]) => [id, l.filter((x: any) => x.date >= m.from && x.date <= m.to)]))
      send({ type: "range", from: m.from, to: m.to, logs, ...(m.for ? { for: m.for } : {}) })
    }
    if (m.type === "writeFile") {
      const a = document.createElement("a")
      a.href = `data:${m.kind === "pdf" ? "application/pdf" : "image/jpeg"};base64,${m.base64}`
      a.download = m.name
      a.click()
    }
    if (m.type === "writeFile" || m.type === "export") send({ type: "actionResult", ok: true, lines: [`harness: would save ${m.name}`] })
  },
})
