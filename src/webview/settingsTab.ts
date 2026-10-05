// The settings tab: tracking, the CRT, your data, danger, and an output
// console that shows what each action actually did (host actionResult lines).
import type { CrtEffect, WebviewMessage } from "../shared/types"
import { applyCrt } from "./crt"
import { $, el, press } from "./dom"
import type { Change, Store } from "./state"
import { setSaved, wireSteppers } from "./stepper"

type Post = (m: WebviewMessage) => void

const ACTIONS: Record<string, { cmd: string; run: (post: Post, openExport: () => void) => void }> = {
  reveal: { cmd: "rabbithole reveal-storage", run: post => post({ type: "revealStorage" }) },
  export: { cmd: "rabbithole export", run: (_post, open) => open() },
  "backup-all": { cmd: "rabbithole backup --all", run: post => post({ type: "createBackup", scope: "all" }) },
  "backup-some": { cmd: "rabbithole backup --projects", run: post => post({ type: "createBackup", scope: "projects" }) },
  "restore-some": { cmd: "rabbithole restore --projects", run: post => post({ type: "importData", scope: "projects" }) },
  "restore-all": { cmd: "rabbithole restore --all", run: post => post({ type: "importData", scope: "all" }) },
}

export function initSettings(store: Store, post: Post, openExport: () => void): void {
  wireSteppers($("set-tracking"), (inp, value, was, button) => {
    if (value === null) return
    post({ type: "updateSetting", key: inp.id === "pref-target" ? "dailyTargetMinutes" : "idleThresholdMinutes", value })
    store.note("ok", `${button.dataset.label} set to ${value}m (was ${was}m)`)
  })

  $("osd").addEventListener("click", e => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button[data-v]") : null
    const key = b?.closest<HTMLElement>("[data-key]")?.dataset.key
    const crt = store.settings?.crt
    if (!b || !key || !crt) return
    const v = b.dataset.v ?? ""
    if (key === "effects") {
      const effect = v as CrtEffect
      const value = crt.effects.includes(effect) ? crt.effects.filter(x => x !== effect) : [...crt.effects, effect]
      post({ type: "updateCrtSetting", key: "effects", value })
    } else if (key === "mask" || key === "pitch") {
      post({ type: "updateCrtSetting", key, value: v })
    }
  })
  for (const key of ["strength", "vignette"] as const) {
    const slider = $<HTMLInputElement>(key)
    // preview while dragging; write once, on release
    slider.addEventListener("input", () => {
      $(`${key}-out`).textContent = `${slider.value}%`
      if (store.settings) applyCrt({ ...store.settings.crt, [key]: Number(slider.value) })
    })
    slider.addEventListener("change", () => post({ type: "updateCrtSetting", key, value: Number(slider.value) }))
  }

  document.querySelectorAll<HTMLButtonElement>("[data-act]").forEach(b => b.addEventListener("click", () => {
    const action = ACTIONS[b.dataset.act ?? ""]
    if (!action) return
    store.note("cmd", action.cmd)
    action.run(post, openExport)
  }))

  // type-to-confirm: trimmed, case-sensitive; the exact project name, or DELETE
  const proj = $<HTMLSelectElement>("clear-proj")
  const projConfirm = $<HTMLInputElement>("clear-proj-confirm")
  const projBtn = $<HTMLButtonElement>("clear-proj-btn")
  const projName = () => proj.selectedOptions[0]?.textContent ?? ""
  const syncClear = () => { projBtn.disabled = !projName() || projConfirm.value.trim() !== projName() }
  proj.addEventListener("change", syncClear)
  projConfirm.addEventListener("input", syncClear)
  projBtn.addEventListener("click", () => {
    const name = projName()
    if (!proj.value || projConfirm.value.trim() !== name) return
    store.note("cmd", `rabbithole clear --project ${name}`)
    post({ type: "clearProject", projectId: proj.value })
    projConfirm.value = ""
    syncClear()
  })
  const allConfirm = $<HTMLInputElement>("clear-all-confirm")
  const allBtn = $<HTMLButtonElement>("clear-all-btn")
  allConfirm.addEventListener("input", () => { allBtn.disabled = allConfirm.value.trim() !== "DELETE" })
  allBtn.addEventListener("click", () => {
    if (allConfirm.value.trim() !== "DELETE") return
    store.note("cmd", "rabbithole clear --all")
    post({ type: "clearAll" })
    allConfirm.value = ""
    allBtn.disabled = true
  })
}

export function renderSettings(store: Store, change: Change | "tab"): void {
  const s = store.settings
  if (s) {
    setSaved($<HTMLInputElement>("pref-target"), String(s.dailyTargetMinutes))
    setSaved($<HTMLInputElement>("pref-idle"), String(s.idleThresholdMinutes))
    $("spath").textContent = s.storagePath
    $("osd").querySelectorAll<HTMLElement>("[data-key]").forEach(g => {
      const key = g.dataset.key
      press(g, b => (key === "effects"
        ? s.crt.effects.includes(b.dataset.v as CrtEffect)
        : b.dataset.v === (key === "mask" ? s.crt.mask : s.crt.pitch)))
    })
    for (const key of ["strength", "vignette"] as const) {
      const slider = $<HTMLInputElement>(key)
      if (document.activeElement !== slider) {
        slider.value = String(s.crt[key])
        $(`${key}-out`).textContent = `${s.crt[key]}%`
      }
    }
  }
  // rebuilt only when the project list changes, so a pending choice survives the 10 s refresh
  const year = store.year
  const proj = $<HTMLSelectElement>("clear-proj")
  const ids = year ? year.projects.map(p => `${p.id}\u0000${p.name}`).join("\u0001") : ""
  if (year && proj.dataset.ids !== ids) {
    const keep = proj.value
    proj.replaceChildren(...year.projects.map(p => {
      const o = el("option", null, p.name)
      o.value = p.id
      return o
    }))
    if (year.projects.some(p => p.id === keep)) proj.value = keep
    proj.dataset.ids = ids
    proj.dispatchEvent(new Event("change"))
  }
  // The console is a live region: rebuilding it on every 10 s tick would make a
  // screen reader read every line again.
  if (change !== "console" && change !== "tab") return
  const lines = store.console
  $("console").replaceChildren(...lines.map((l, i) => el("div", [l.cls, i === lines.length - 1 ? "cursor" : ""].filter(Boolean).join(" ") || null, l.text)))
}
