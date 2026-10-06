// A stand-in for VS Code's webview API that answers the dashboard from fixture
// data, and downloads any file the export dialog asks the host to save.
import { MIN, crowdedWorld, sampleWorld } from "../helpers/exportFixtures"

// ?many: more projects and languages than the palette has colours
const { year, range } = location.search.includes("many") ? crowdedWorld() : sampleWorld()
const settings = {
  type: "settings", dailyTargetMs: 20 * MIN, dailyTargetMinutes: 20, idleThresholdMinutes: 5, storagePath: "/harness",
  crt: { mask: "slot", pitch: "fine", strength: 23, vignette: 35, effects: ["scanlines", "bloom"] },
}
const send = (m: unknown) => setTimeout(() => window.postMessage(m, "*"), 30)

;(window as any).acquireVsCodeApi = () => ({
  getState: () => null,
  setState: () => undefined,
  postMessage: (m: any) => {
    console.log("[harness] webview →", m.type, m)
    if (m.type === "ready") { send(settings); send({ type: "year", ...year }) }
    if (m.type === "requestYear") send({ type: "year", ...year })
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
