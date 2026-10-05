// Draws every share card variant (and, from Task 6, offers every report) from
// fixture data, for a visual check against docs/design/mockups/exports.html.
import { Span, exportData } from "../../src/webview/exportModel"
import { cardFontsReady, drawCard } from "../../src/webview/shareCard"
import { sampleWorld, world } from "../helpers/exportFixtures"

const sample = sampleWorld()
const empty = world({}, { ids: ["alpha"] })
export const CASES: [string, { year: any; range: any }, string, Span][] = [
  ["today, all projects", sample, "all", "today"],
  ["today, rabbit-hole", sample, "rabbit-hole", "today"],
  ["7d, all projects", sample, "all", "7d"],
  ["30d, rabbithole-cli", sample, "rabbithole-cli", "30d"],
  ["today, empty install", empty, "all", "today"],
  ["30d, empty install", empty, "all", "30d"],
]

async function main(): Promise<void> {
  await cardFontsReady()
  const host = document.getElementById("cards")!
  for (const [label, w, sel, span] of CASES) {
    if (span === "90d") continue
    const fig = document.createElement("figure")
    const canvas = document.createElement("canvas")
    drawCard(canvas, exportData(w.range, w.year, sel, span, Date.now()))
    const cap = document.createElement("figcaption")
    cap.textContent = label
    fig.append(canvas, cap)
    host.append(fig)
  }
}
void main()
