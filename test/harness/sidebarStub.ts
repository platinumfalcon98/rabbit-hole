// A stand-in for VS Code's webview API that answers the sidebar from fixture data.
import { MIN, crowdedWorld, sampleWorld, todayLogs } from "../helpers/exportFixtures"

// ?many: more projects than the palette has colours
const w = location.search.includes("many") ? crowdedWorld() : sampleWorld()
const settings = {
  type: "settings", dailyTargetMs: 20 * MIN, dailyTargetMinutes: 20, idleThresholdMinutes: 5, storagePath: "/harness",
  crt: { mask: "slot", pitch: "fine", strength: 23, vignette: 35, effects: ["scanlines", "bloom"] },
}
const send = (m: unknown) => setTimeout(() => window.postMessage(m, "*"), 30)

;(window as any).acquireVsCodeApi = () => ({
  postMessage: (m: any) => {
    console.log("[harness] sidebar →", m.type)
    if (m.type === "ready") {
      send(settings)
      send({ type: "mini", year: w.year, logs: todayLogs(w) })
    }
  },
})
