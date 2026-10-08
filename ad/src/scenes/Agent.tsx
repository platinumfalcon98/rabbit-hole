// 0:34–0:44 — the wow scene, on the first dip. README.md stays focused while a
// terminal agent edits Go; when the mouse clicks back into the editor the
// held span resolves and the real languages panel moves the time from
// markdown to Go (it only moves, never adds).
import { AbsoluteFill, useCurrentFrame } from "remotion"
import { agentLive } from "../data/agentLive"
import { MIN, showcase } from "../data/showcase"
import { Cursor } from "../cursor/Cursor"
import { UiFrame } from "../ui/UiFrame"
import { easeIn, easeInOut, easeOut, ramp } from "./beat"
import { AGENT, AGENT_CAM, AGENT_CARD, AGENT_CURSOR, AGENT_OUT, PROMPT } from "./plan3"
import { README } from "./readme"
import { shot } from "./shots"
import { VsCodeFrame } from "./VsCodeFrame"
import { World } from "./World"

const S = shot("agent")
const data = showcase()
const today = data.year.global.active[data.year.global.active.length - 1]

function Terminal({ f }: { f: number }) {
  const typed = Math.max(0, Math.min(PROMPT.length, Math.floor((f - AGENT.typeFrom) / AGENT.typeEvery)))
  return (
    <div style={{ padding: "8px 24px", fontFamily: "'Martian Mono'", fontSize: 21, lineHeight: "36px", color: "#cccccc" }}>
      <div><span style={{ color: "#39d98a" }}>~/code/rabbithole-cli</span> <span style={{ color: "#8b8b8b" }}>$</span> {PROMPT.slice(0, typed)}
        {f < AGENT.typeFrom + PROMPT.length * AGENT.typeEvery + 20 && Math.floor(f / 12) % 2 === 0 && <span style={{ background: "#cccccc", color: "#181818" }}> </span>}
      </div>
      {AGENT_OUT.map((l, i) => {
        const t = easeOut(ramp(f, l.at, l.at + 8))
        if (t <= 0) return null
        const busy = i === AGENT_OUT.length - 2 && f < AGENT_OUT[AGENT_OUT.length - 1].at
        return (
          <div key={i} style={{ opacity: t, transform: `translateX(${(1 - t) * -24}px)`, color: l.tone === "ok" ? "#39d98a" : l.tone === "dim" ? "#8b8b8b" : "#cccccc", whiteSpace: "pre" }}>
            {l.text.replace(/(\+\d+)/, "\u0000$1").split("\u0000").map((p, j) => <span key={j} style={j ? { color: "#39d98a" } : undefined}>{p}</span>)}
            {busy && <span style={{ color: "#ffb703" }}> {"⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[Math.floor(f / 3) % 10]}</span>}
          </div>
        )
      })}
    </div>
  )
}

export const Agent: React.FC = () => {
  const f = useCurrentFrame()
  const panel = easeInOut(ramp(f, AGENT.panelFrom, AGENT.panelTo))
  const card = easeOut(ramp(f, AGENT.cardIn, AGENT.cardInTo))
  const exit = easeIn(ramp(f, AGENT.exit, 578))
  const shift = easeInOut(ramp(f, AGENT.shiftFrom, AGENT.shiftTo))
  const view = {
    ...S.view,
    live: agentLive(f < AGENT.shiftFrom ? 0 : shift),
    focus: f >= AGENT.hoverGo && f < AGENT.leave ? { kind: "language" as const, id: "go" } : null,
    reveal: { bars: ramp(f, AGENT.cardIn + 6, AGENT.cardInTo + 10), rows: ramp(f, AGENT.cardIn, AGENT.cardInTo + 6) },
  }
  // the moment of resolution: a flash on the card
  const flash = f >= AGENT.shiftTo && f < AGENT.shiftTo + 16 ? 1 - (f - AGENT.shiftTo) / 16 : 0
  return (
    <AbsoluteFill style={{ opacity: 1 - exit, transform: `scale(${1 - 0.1 * exit})` }}>
      <World cam={AGENT_CAM}>
        <VsCodeFrame
          file="README.md" tabs={["README.md", "week.go", "main.go"]} lines={README}
          caretLine={f >= AGENT.click ? 7 : 11} caretOn={Math.floor(f / 30) % 2 === 0}
          activeMs={today + (f >= AGENT.click ? 0 : -MIN)} targetMs={20 * MIN} statusLang="Markdown"
          panel={<Terminal f={f} />} panelOpen={panel} panelH={420}
        />
        <div style={{
          position: "absolute", left: AGENT_CARD.x, top: AGENT_CARD.y, width: S.width, height: S.height, transformOrigin: "0 0",
          transform: `translateX(${(1 - card) * 900}px) scale(${AGENT_CARD.scale}) rotate(${(1 - card) * 4}deg)`,
          borderRadius: 10, overflow: "hidden",
          boxShadow: `0 30px 90px rgba(0,0,0,.7), 0 0 0 1px #22392d, 0 0 ${60 * flash}px rgba(57,217,138,${0.8 * flash})`,
        }}>
          <UiFrame width={S.width} height={S.height} view={view} />
        </div>
        <Cursor keys={AGENT_CURSOR} visibleFrom={196} visibleTo={AGENT.leave} />
      </World>
    </AbsoluteFill>
  )
}
