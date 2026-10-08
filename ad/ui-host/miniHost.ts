// The sidebar host: answers the real mini.ts bundle with the showcase's `mini`
// payload and applies one UiView per frame (window.__apply), like host.ts.
import type { UiView } from "../src/ui/view"
import { applyReveals, clone, countUp, data, deliver, ease, fontsReady, frames, installApi, itemT, pointer, setShotCss, settingsMsg, showTooltip } from "./stub"

installApi((m: any) => {
  if (m.type === "ready") { deliver(settingsMsg as any); deliver({ type: "mini", ...clone(data.mini) }) }
})

const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel))
let lastJson = ""

function reveal(view: UiView): void {
  applyReveals(view, {
    count: p => ["#td-t", "#st-n", "#ln-a", "#ln-d"].forEach(s => $$(s).forEach(e => countUp(e, p))),
    tape: p => {
      const cells = $$("#tape span")
      cells.forEach((c, i) => {
        const t = ease(itemT(p, i, cells.length, 1.5))
        c.style.opacity = t >= 1 ? "" : String(c.classList.contains("off") ? 0.15 + 0.4 * t : t)
      })
    },
    week: p => $$("#wk-cols .col").forEach((c, i, all) => {
      const t = ease(itemT(p, i, all.length, 2))
      c.style.clipPath = t >= 1 ? "" : `inset(${((1 - t) * 100).toFixed(1)}% 0 0 0)`
    }),
    bars: p => $$("#pj-split").forEach(s => { s.style.clipPath = p >= 1 ? "" : `inset(0 ${((1 - ease(p)) * 100).toFixed(1)}% 0 0)` }),
    rows: p => $$("fieldset, .open").forEach((r, i, all) => {
      const t = ease(itemT(p, i, all.length, 2))
      r.style.opacity = t >= 1 ? "" : String(t)
      r.style.transform = t >= 1 ? "" : `translateX(${((1 - t) * -60).toFixed(1)}px)`
    }),
  })
}

async function apply(view: UiView): Promise<void> {
  const json = JSON.stringify(view)
  if (json === lastJson) return frames(1)
  lastJson = json
  setShotCss(view)
  await frames(1)
  const root = document.getElementById("mini")!
  pointer("pointerleave", root)
  const f = view.focus
  const t = f && document.querySelector(`#pj-list [data-hl="p:${CSS.escape(f.id)}"]`)
  if (t) pointer("pointerover", t)
  await frames(1)
  showTooltip(view)
  reveal(view)
  await frames(2)
}

let ready: Promise<void> | null = null
;(window as any).__apply = async (view: UiView): Promise<void> => {
  ready ??= (async () => { await fontsReady(); await frames(2) })()
  await ready
  await apply(view)
}
