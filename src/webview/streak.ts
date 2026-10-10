// The streak: storage's count, fourteen day marks, the longest run. No decoration.
import type { YearPayload } from "../shared/types"
import { $, el } from "./dom"
import { MIN, dstr, fmt, shortDate } from "./format"
import { Selection, seriesFor, seriesUntil, streakInfo, streakOn } from "./model"
import { bindTip, tipLine } from "./tooltip"

// `date`: the last day of the view. Today keeps the live wording; a past day
// shows the streak as it stood that night, with the 14 days ending on it.
export function renderStreak(year: YearPayload, sel: Selection, date: string): void {
  const isToday = date === year.today
  const s = seriesUntil(seriesFor(year, sel), date)
  const info = streakInfo(s, streakOn(year, sel, date))
  const n = s.days.length
  $("streak-n").textContent = String(info.current)
  $("streak-big").classList.toggle("zero", info.current === 0)
  const from = Math.max(0, n - 14)
  $("days").replaceChildren(...s.days.slice(from).map((day, k) => {
    const i = from + k
    const now = isToday && i === n - 1
    const hit = s.active[i] >= s.targetMs[i]
    const mark = el("span", now ? "now" : hit ? "hit" : "miss", now ? (hit ? "◆" : "◇") : hit ? "■" : "□")
    bindTip(mark, () => [tipLine(
      now ? (hit ? "today, target met" : `today, ${fmt(info.todayRemainingMs)} to go`) : hit ? "target met" : "missed",
      dstr(day),
    )])
    return mark
  }))
  const target = n ? s.targetMs[n - 1] : year.globalTargetMs
  const mins = Math.round(target / MIN)
  $("days").setAttribute("aria-label", `14 days to ${isToday ? "today" : dstr(date)} against the ${mins} minute target`)
  const parts = [info.longest && info.longestEnd ? `Longest run ${info.longest} days, ended ${shortDate(info.longestEnd)}.` : "No streak yet."]
  if (isToday && info.atRisk) parts.push(`At risk today: ${fmt(info.todayRemainingMs)} to go.`)
  if (sel !== "all" && target !== year.globalTargetMs) parts.push(`Uses this project's ${mins}m target.`)
  $("streak-long").textContent = parts.join(" ")
}
