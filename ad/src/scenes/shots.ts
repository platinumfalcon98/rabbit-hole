// The UI shots: which page, at what size, with which base view (layout CSS,
// zoom, tab…), and the elements the cursor aims at in it. scripts/measure-ui.ts
// measures the targets into layout.json; scenes build their per-frame views
// on these bases.
import { AT_RISK_PROJECT, HERO_PROJECT } from "../data/showcase"
import type { UiView } from "../ui/view"

export interface Shot {
  id: string
  page: "host" | "mini"
  width: number
  height: number
  view: UiView
  targets: Record<string, string>
}

const q = (s: string) => JSON.stringify(s)
const hideBar = ".bar { display: none !important; } body { padding-top: 26px; }"
// the overview's fieldsets, in markup order: hero, streak, lines, languages, files, sessions
const keepOverview = (...n: number[]) => `#ov .grid > fieldset${n.map(i => `:not(:nth-child(${i}))`).join("")} { display: none !important; }`

export const SHOTS: Shot[] = [
  {
    id: "mini", page: "mini", width: 348, height: 780,
    view: { zoom: 1 },
    targets: { cli: `#pj-list [data-hl=${q("p:" + HERO_PROJECT)}]`, open: "#open", today: "#td-t" },
  },
  {
    id: "today", page: "host", width: 1440, height: 1300,
    view: {
      tab: "overview", range: "today", zoom: 2.25,
      css: `${hideBar} ${keepOverview(1, 4)} #ov .grid { grid-template-columns: 1fr !important; } #ov .grid > fieldset { grid-column: 1 / -1 !important; }`,
    },
    targets: { go: `#lang [data-hl="l:go"]`, ts: `#lang [data-hl="l:typescript"]`, big: "#hero-head .big", target: "#target", tape: "#tape", lang: "#lang" },
  },
  {
    id: "month", page: "host", width: 1440, height: 1080,
    view: {
      tab: "overview", range: "30d", zoom: 1.55,
      css: `${keepOverview(1)} .projpick, .tabs, #r-cal, #range button[data-range="yday"] { visibility: hidden; } #ov .grid > fieldset { grid-column: 1 / -1 !important; } .cols { height: 330px !important; }`,
    },
    targets: { d30: `#range button[data-range="30d"]`, col: `#cols .c[data-i="19"]`, col2: `#cols .c[data-i="9"]`, cols: "#cols" },
  },
  {
    id: "agent", page: "host", width: 760, height: 520,
    view: {
      tab: "overview", range: "today", sel: HERO_PROJECT, zoom: 1.45,
      css: `${hideBar} ${keepOverview(4)} #ov .grid > fieldset { grid-column: 1 / -1 !important; } body { padding: 14px 12px; }`,
    },
    targets: { go: `#lang [data-hl="l:go"]`, md: `#lang [data-hl="l:markdown"]` },
  },
  {
    id: "year", page: "host", width: 1440, height: 1080,
    view: { tab: "activity", zoom: 1.32, css: `.bar .range, .projpick { visibility: hidden; } .filters { display: none !important; }` },
    targets: { cli: `.prow[data-ap=${q(HERO_PROJECT)}]`, heat: "#heat", stats: "#ystats" },
  },
  {
    id: "streaks", page: "host", width: 1440, height: 1080,
    view: { tab: "projects", zoom: 1.5, css: `${hideBar} .filters { display: none !important; } #pcards .pcard .target, #pcards .pcard .foot { display: none !important; }` },
    targets: { risk: "#pcards .pcard:nth-child(4) .stats > div:nth-child(2)", card: "#pcards .pcard:nth-child(4)" },
  },
  {
    id: "share", page: "host", width: 1440, height: 1080,
    view: { tab: "settings", zoom: 1.5, exportOpen: true, css: hideBar },
    targets: { go: "#xd-go", canvas: "#xd-preview canvas", dialog: "#xd .xd" },
  },
  {
    id: "settings", page: "host", width: 1440, height: 1080,
    view: { tab: "settings", zoom: 1.5, scrollY: 0, css: hideBar },
    targets: { export: `[data-act="export"]` },
  },
]

export const shot = (id: string): Shot => SHOTS.find(s => s.id === id)!
// keep the at-risk project referenced, so a rename here is caught by tsc
export const RISK = AT_RISK_PROJECT
