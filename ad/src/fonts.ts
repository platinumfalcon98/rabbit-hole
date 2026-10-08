// Martian Mono for everything Remotion draws itself (captions, chrome), and the
// extension's registered carrot icon font for the status bar. Both are the
// extension's own files, copied into public/ui by scripts/build-ui.mjs.
import { continueRender, delayRender, staticFile } from "remotion"

let started = false
export function loadFonts(): void {
  if (started || typeof document === "undefined") return
  started = true
  const handle = delayRender("fonts")
  const faces = [
    new FontFace("Martian Mono", `url(${staticFile("ui/fonts/MartianMono-VF.woff2")}) format("woff2")`, { weight: "100 800", stretch: "75% 112.5%" }),
    new FontFace("rabbithole-icons", `url(${staticFile("ui/fonts/rabbithole-icons.woff")}) format("woff")`),
  ]
  Promise.all(faces.map(f => f.load().then(x => { document.fonts.add(x) })))
    .then(() => document.fonts.ready)
    .catch(err => console.error("font load failed", err))
    .finally(() => continueRender(handle))
}
