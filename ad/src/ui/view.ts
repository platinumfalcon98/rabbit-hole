// What a frame asks of the real dashboard (or sidebar). Every field is absolute:
// the host applies a view from scratch-equivalent state, so a frame rendered
// alone looks the same as in sequence (Remotion renders out of order).
import type { LivePayload } from "../../../src/shared/types"

export type Tab = "overview" | "activity" | "projects" | "settings"
export type RangeBtn = "today" | "yday" | "7d" | "30d"
export interface UiFocus { kind: "project" | "language"; id: string }

export interface UiView {
  tab?: Tab                                 // dashboard only; default overview
  range?: RangeBtn                          // overview's range buttons; default today
  sel?: string                              // the project picker: a project id or "all" (default)
  focus?: UiFocus | null                    // hover focus, through the real pointer events
  tooltipAt?: { selector: string; fx?: number; fy?: number } | null   // the real tooltip for an element (fx/fy: where in it, 0..1)
  reveal?: Partial<Record<RevealKind, number>>                       // per-panel animation progress 0..1
  live?: LivePayload | null                 // a live update merged into the data (count-ups of stored state, the agent shift)
  exportOpen?: boolean                      // the export dialog, opened through the settings button
  zoom?: number                             // CSS zoom of the whole page (the phone-size scale-up)
  css?: string                              // per-shot layout rules (isolating panels, re-flowing for 4:3)
  scrollY?: number                          // page scroll, in zoomed CSS px
}

export type RevealKind =
  | "count"    // numbers count up from 0 (hero total, lines, streak, year stats, card stats, sidebar)
  | "tape"     // day-tape cells fill left to right
  | "meter"    // the target meter's blocks
  | "cols"     // range columns drop in one by one
  | "heat"     // heatmap, week by week
  | "bars"     // language / project bars and the share split grow
  | "cards"    // project cards flip in
  | "week"     // the lines panel's / sidebar's week columns
  | "spark"    // sparklines
  | "rows"     // list rows (files, sessions, days, project list) slide in
  | "card"     // the export dialog's share-card preview draws in, top to bottom
  | "fly"      // the share card flies out of the screen (0 = in place)
