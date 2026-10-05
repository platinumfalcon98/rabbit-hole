// − / + / apply controls for a minutes input, shared by Settings and the
// project cards. Markup:
//   <button data-for="ID" data-step="-5">
//   <input id="ID" type="number" min max data-saved="20" [data-optional]>
//   <button data-apply="ID" data-label="daily target">
// data-optional means empty is valid: a project falling back to the global target.

export function validFor(value: string, min: number, max: number, optional: boolean): boolean {
  const v = value.trim()
  if (v === "") return optional
  if (!/^\d+$/.test(v)) return false
  const n = Number(v)
  return n >= min && n <= max
}

export function stepValue(value: string, placeholder: string, step: number, min: number, max: number): string {
  const raw = value.trim() === "" ? Number(placeholder) : Number(value)
  const base = isFinite(raw) ? raw : 0
  return String(Math.min(max, Math.max(min, base + step)))
}

// apply lights up only for a valid value that differs from the saved one
export function syncApply(inp: HTMLInputElement): void {
  const ap = document.querySelector<HTMLButtonElement>(`[data-apply="${inp.id}"]`)
  if (!ap) return
  const ok = validFor(inp.value, Number(inp.min), Number(inp.max), inp.dataset.optional !== undefined)
  ap.disabled = !ok || inp.value.trim() === (inp.dataset.saved ?? "")
}

// A value being typed is kept; only an untouched input follows the saved one.
export function setSaved(inp: HTMLInputElement, value: string): void {
  if (document.activeElement !== inp && inp.value.trim() === (inp.dataset.saved ?? "")) inp.value = value
  inp.dataset.saved = value
  syncApply(inp)
}

export type OnApply = (inp: HTMLInputElement, value: number | null, was: string, button: HTMLButtonElement) => void

export function wireSteppers(root: HTMLElement, onApply: OnApply): void {
  root.addEventListener("click", e => {
    const t = e.target instanceof Element ? e.target : null
    const step = t?.closest<HTMLButtonElement>("[data-step]")
    if (step && root.contains(step)) {
      const inp = document.getElementById(step.dataset.for ?? "") as HTMLInputElement | null
      if (!inp) return
      inp.value = stepValue(inp.value, inp.placeholder, Number(step.dataset.step), Number(inp.min), Number(inp.max))
      syncApply(inp)
      return
    }
    const ap = t?.closest<HTMLButtonElement>("[data-apply]")
    if (!ap || ap.disabled || !root.contains(ap)) return
    const inp = document.getElementById(ap.dataset.apply ?? "") as HTMLInputElement | null
    if (!inp) return
    const was = inp.dataset.saved ?? ""
    const now = inp.value.trim()
    inp.dataset.saved = now
    onApply(inp, now === "" ? null : Number(now), was, ap)
    ap.disabled = true
    ap.textContent = "saved"
    ap.classList.add("ok")
    setTimeout(() => {
      ap.textContent = "apply"
      ap.classList.remove("ok")
    }, 1400)
  })
  root.addEventListener("input", e => {
    if (e.target instanceof HTMLInputElement && e.target.type === "number") syncApply(e.target)
  })
}
