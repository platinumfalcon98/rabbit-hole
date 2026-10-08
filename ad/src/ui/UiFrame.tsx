// The real dashboard (host.html) or sidebar (mini.html) in an iframe, driven
// frame by frame: each frame's view is applied through the host's __apply and
// the frame is held (delayRender) until the real UI has rendered it.
import { useEffect, useRef } from "react"
import { continueRender, delayRender, staticFile } from "remotion"
import type { UiView } from "./view"

type Win = Window & { __apply?: (v: UiView) => Promise<void> }

export const UiFrame: React.FC<{
  page?: "host" | "mini"
  view: UiView
  width: number
  height: number
  style?: React.CSSProperties
}> = ({ page = "host", view, width, height, style }) => {
  const ref = useRef<HTMLIFrameElement>(null)
  const loaded = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null)
  if (!loaded.current) {
    let resolve = () => {}
    const promise = new Promise<void>(r => { resolve = r })
    loaded.current = { promise, resolve }
  }
  const json = JSON.stringify(view)
  useEffect(() => {
    const handle = delayRender(`ui ${page} view`, { timeoutInMilliseconds: 60_000 })
    let done = false
    ;(async () => {
      await loaded.current!.promise
      const win = ref.current?.contentWindow as Win | null
      for (let i = 0; i < 200 && !win?.__apply; i++) await new Promise(r => setTimeout(r, 25))
      await win?.__apply?.(JSON.parse(json))
    })().catch(err => console.error(err)).finally(() => {
      if (!done) { done = true; continueRender(handle) }
    })
    return () => { if (!done) { done = true; continueRender(handle) } }
  }, [json, page])
  return (
    <iframe
      ref={ref}
      src={staticFile(`ui/${page}.html`)}
      onLoad={() => loaded.current!.resolve()}
      style={{ width, height, border: 0, display: "block", background: "transparent", ...style }}
    />
  )
}
