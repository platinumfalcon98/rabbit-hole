// 1:03–1:06 — everything pulls back into the carrot (local: no account, no
// cloud). 1:06–1:10 — the end card: carrot, RABBIT HOLE, LIVE ON VSCODE
// MARKETPLACE, while the music fades.
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { decodeText } from "../captions/effects"
import { UiFrame } from "../ui/UiFrame"
import { easeIn, easeInOut, easeOut, outBack, ramp } from "./beat"
import { END, LOCAL } from "./plan4"
import { CarrotPixels } from "./PowerOn"

const CARROT_Y = 330
const PX = 22

function Carrot({ scale, glow, rot = 0 }: { scale: number; glow: number; rot?: number }) {
  return (
    <div style={{ position: "absolute", left: 720, top: CARROT_Y, transform: `translate(-50%, -50%) scale(${scale}) rotate(${rot}deg)` }}>
      <CarrotPixels size={PX} glow={glow} />
    </div>
  )
}

export const Local: React.FC = () => {
  const f = useCurrentFrame()
  const pull = easeIn(ramp(f, 0, LOCAL.pullTo))
  const grow = outBack(ramp(f, 46, LOCAL.land + 6), 2)
  const ring = ramp(f, LOCAL.land, LOCAL.land + 30)
  return (
    <AbsoluteFill>
      {/* the whole dashboard, sucked into the carrot */}
      {pull < 1 && (
        <div style={{
          position: "absolute", left: 0, top: 0, width: 1440, height: 1080, transformOrigin: `720px ${CARROT_Y}px`,
          transform: `scale(${1 - 0.985 * pull}) rotate(${-28 * pull}deg)`, opacity: 1 - easeIn(ramp(f, 50, LOCAL.pullTo)),
          filter: `brightness(${1 + pull * 1.5}) blur(${pull * 3}px)`, borderRadius: 12, overflow: "hidden",
        }}>
          <UiFrame width={1440} height={1080} view={{ tab: "overview", range: "today", zoom: 1.1 }} />
        </div>
      )}
      {/* streaks of light falling inward */}
      {Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * Math.PI * 2 + 0.3
        const t = ramp(f, 8 + (i % 6) * 6, 44 + (i % 6) * 6)
        if (t <= 0 || t >= 1) return null
        const r = 900 * (1 - easeIn(t))
        return <div key={i} style={{ position: "absolute", left: 720 + Math.cos(a) * r, top: CARROT_Y + Math.sin(a) * r, width: 60, height: 3, background: "linear-gradient(90deg, transparent, #ffb703)", transform: `rotate(${(a * 180) / Math.PI + 180}deg)`, transformOrigin: "0 50%", opacity: 0.8 }} />
      })}
      {f >= 46 && <Carrot scale={Math.max(0.01, grow)} glow={1.2 + (1 - ring)} />}
      {ring > 0 && ring < 1 && (
        <div style={{ position: "absolute", left: 720 - 400 * ring, top: CARROT_Y - 400 * ring, width: 800 * ring, height: 800 * ring, borderRadius: "50%", border: `${4 * (1 - ring)}px solid rgba(255,183,3,${1 - ring})`, boxShadow: `0 0 40px rgba(255,139,0,${0.6 * (1 - ring)})` }} />
      )}
    </AbsoluteFill>
  )
}

export const End: React.FC = () => {
  const f = useCurrentFrame()
  const slam = ramp(f, END.title, END.title + 12)
  const live = ramp(f, END.live, END.live + 34)
  const pulse = 1 + 0.5 * Math.max(0, 1 - Math.abs(f - END.pulse) / 14)
  const fade = easeInOut(ramp(f, END.fadeFrom, 280))
  const breathe = 1 + 0.02 * Math.sin(f / 18)
  return (
    <AbsoluteFill style={{ transform: `scale(${1 + f * 0.0004})` }}>
      <Carrot scale={breathe} glow={1.2 * pulse} rot={Math.sin(f / 50) * 1.5} />
      {f >= END.title && (
        <div style={{
          position: "absolute", left: 0, right: 0, top: 500, textAlign: "center", fontFamily: "'Martian Mono'", fontWeight: 800, fontSize: 150,
          fontVariationSettings: '"wdth" 75', letterSpacing: "-0.01em", color: "#ffe9c7",
          textShadow: `0 0 3px rgba(255,220,160,.9), 0 0 ${24 * pulse}px rgba(255,139,0,.65), 0 0 70px rgba(255,139,0,.3)`,
          transform: `scale(${1 + 2 * (1 - outBack(slam, 1.5))})`, filter: `blur(${(1 - easeOut(slam)) * 14}px)`, opacity: Math.min(1, (f - END.title) / 3),
        }}>RABBIT HOLE</div>
      )}
      {f >= END.live && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 690, display: "flex", justifyContent: "center", opacity: easeOut(ramp(f, END.live, END.live + 6)) }}>
          <div style={{
            background: "#ffb703", color: "#1a1300", fontFamily: "'Martian Mono'", fontWeight: 800, fontSize: 92, lineHeight: 1.08, textAlign: "center",
            fontVariationSettings: '"wdth" 75', padding: "18px 44px", borderRadius: 6, whiteSpace: "pre",
            boxShadow: `0 0 ${50 * pulse}px rgba(255,183,3,.55), 0 0 140px rgba(255,139,0,.25)`,
            clipPath: `inset(0 ${(1 - easeOut(ramp(f, END.live, END.live + 10))) * 50}% 0 ${(1 - easeOut(ramp(f, END.live, END.live + 10))) * 50}%)`,
          }}>
            {decodeText("LIVE ON", live, 21, f)}{"\n"}{decodeText("VSCODE MARKETPLACE", live, 22, f)}
          </div>
        </div>
      )}
      <AbsoluteFill style={{ background: "#000", opacity: fade }} />
    </AbsoluteFill>
  )
}
