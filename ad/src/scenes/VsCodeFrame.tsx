// The VS Code window chrome (an allowed extra): title bar, Activity Bar with the
// extension's real Activity Bar icon, an optional sidebar holding the real
// Rabbit Hole view, the editor, an optional terminal panel, and the status bar
// with the extension's real status text and registered carrot glyph.
import { staticFile } from "remotion"
import { statusText } from "../../../src/shared/statusText"
import { ACT_SLOT, ACT_W, CARROT_SLOT, SIDEBAR_W, STATUS_H, TITLE_H, WIN } from "./plan"

const C = {
  title: "#181818", act: "#181818", side: "#181818", editor: "#1f1f1f", tabOff: "#181818", border: "#2b2b2b",
  text: "#cccccc", dim: "#8b8b8b", faint: "#5a5a5a", accent: "#0078d4", status: "#181818",
}
const MONO = "'Martian Mono'"

function Icon({ k, active, hot }: { k: number; active: boolean; hot: number }) {
  const col = active || hot > 0 ? "#e7e7e7" : "#868686"
  const s = { position: "absolute" as const, left: 0, top: TITLE_H + 10 + ACT_SLOT * k, width: ACT_W, height: ACT_SLOT, display: "flex", alignItems: "center", justifyContent: "center" }
  const svg = (d: React.ReactNode) => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  const icons = [
    svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>),
    svg(<><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /></>),
    svg(<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-6 3-11 7" /></>),
    svg(<><path d="M7 4l12 8-12 8z" /></>),
    svg(<><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="14.5" y="14.5" width="5" height="5" transform="rotate(45 17 17)" /></>),
  ]
  return (
    <div style={s}>
      {active && <div style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, background: "#e7e7e7" }} />}
      {hot > 0 && <div style={{ position: "absolute", inset: 6, borderRadius: 8, background: `rgba(255,183,3,${0.16 * hot})`, boxShadow: `0 0 ${24 * hot}px rgba(255,139,0,${0.5 * hot})` }} />}
      {k === CARROT_SLOT
        ? <div style={{
            width: 34, height: 24, background: col, WebkitMaskImage: `url(${staticFile("ui/activitybar-icon.svg")})`, WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat", WebkitMaskPosition: "center", filter: hot > 0 ? `drop-shadow(0 0 ${8 * hot}px rgba(255,139,0,.9))` : undefined,
          }} />
        : icons[k]}
    </div>
  )
}

export interface EditorLine { text: string; color?: string }

export const VsCodeFrame: React.FC<{
  file: string
  tabs: string[]
  lines: EditorLine[]
  caretLine?: number
  caretOn?: boolean
  sidebar?: React.ReactNode
  sidebarOpen?: number       // 0..1
  carrotHot?: number         // 0..1 hover glow on the Activity Bar carrot
  panel?: React.ReactNode
  panelOpen?: number         // 0..1
  panelH?: number
  activeMs: number
  targetMs: number
  statusLang: string
}> = ({ file, tabs, lines, caretLine, caretOn, sidebar, sidebarOpen = 0, carrotHot = 0, panel, panelOpen = 0, panelH = 380, activeMs, targetMs, statusLang }) => {
  const sideW = SIDEBAR_W * sidebarOpen
  const bodyH = WIN.h - TITLE_H - STATUS_H
  const pH = panelH * panelOpen
  const status = statusText(activeMs, targetMs).replace("$(rabbithole-carrot)", "")
  return (
    <div style={{ position: "absolute", left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h, background: C.editor, borderRadius: 10, overflow: "hidden", fontFamily: MONO, color: C.text, boxShadow: "0 40px 120px rgba(0,0,0,.65), 0 0 0 1px #333" }}>
      {/* title bar */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: TITLE_H, background: C.title, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", fontSize: 14 }}>
        <span style={{ width: ACT_W, textAlign: "center", color: "#3b9cff", fontWeight: 700 }}>⌘</span>
        <span style={{ color: C.dim, display: "flex", gap: 18 }}>{["File", "Edit", "Selection", "View", "Go", "Terminal"].map(m => <span key={m}>{m}</span>)}</span>
        <span style={{ position: "absolute", left: 0, right: 0, textAlign: "center", color: C.text, pointerEvents: "none" }}>{file} — rabbithole-cli — Visual Studio Code</span>
      </div>
      {/* activity bar */}
      <div style={{ position: "absolute", left: 0, top: 0, width: ACT_W, bottom: STATUS_H, background: C.act, borderRight: `1px solid ${C.border}` }}>
        {[0, 1, 2, 3, 4, 5].map(k => <Icon key={k} k={k} active={k === (sidebarOpen > 0.5 ? CARROT_SLOT : 0)} hot={k === CARROT_SLOT ? carrotHot : 0} />)}
      </div>
      {/* sidebar */}
      <div style={{ position: "absolute", left: ACT_W, top: TITLE_H, width: sideW, height: bodyH, background: C.side, borderRight: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{ width: SIDEBAR_W, height: "100%", position: "relative" }}>
          <div style={{ height: 34, display: "flex", alignItems: "center", padding: "0 18px", fontSize: 12, letterSpacing: ".08em", color: C.dim }}>RABBIT HOLE: TODAY</div>
          <div style={{ position: "absolute", left: 0, top: 34, right: 0, bottom: 0 }}>{sidebar}</div>
        </div>
      </div>
      {/* editor */}
      <div style={{ position: "absolute", left: ACT_W + sideW, right: 0, top: TITLE_H, height: bodyH - pH, overflow: "hidden" }}>
        <div style={{ height: 40, background: C.tabOff, display: "flex", borderBottom: `1px solid ${C.border}` }}>
          {tabs.map(t => (
            <div key={t} style={{ padding: "0 22px", display: "flex", alignItems: "center", fontSize: 14, background: t === file ? C.editor : C.tabOff, color: t === file ? "#ffffff" : C.dim, borderTop: t === file ? `2px solid ${C.accent}` : "2px solid transparent", borderRight: `1px solid ${C.border}` }}>
              <span style={{ color: t.endsWith(".md") ? "#519aba" : t.endsWith(".go") ? "#00add8" : "#e8c06a", marginRight: 10 }}>{t.endsWith(".md") ? "M↓" : t.endsWith(".go") ? "go" : "{}"}</span>{t}
            </div>
          ))}
        </div>
        <div style={{ padding: "16px 0", fontSize: 17, lineHeight: "30px" }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "flex", whiteSpace: "pre", background: caretLine === i ? "#282828" : undefined }}>
              <span style={{ width: 64, textAlign: "right", paddingRight: 22, color: caretLine === i ? "#cccccc" : C.faint }}>{i + 1}</span>
              <span style={{ color: l.color ?? C.text }}>{l.text}</span>
              {caretLine === i && caretOn && <span style={{ width: 2, height: 24, marginTop: 3, background: "#aeafad" }} />}
            </div>
          ))}
        </div>
      </div>
      {/* panel */}
      {pH > 0 && (
        <div style={{ position: "absolute", left: ACT_W + sideW, right: 0, top: TITLE_H + bodyH - pH, height: pH, background: "#181818", borderTop: `1px solid ${C.border}`, overflow: "hidden" }}>
          <div style={{ height: 36, display: "flex", alignItems: "center", gap: 26, padding: "0 20px", fontSize: 12, letterSpacing: ".06em", color: C.dim }}>
            <span>PROBLEMS</span><span>OUTPUT</span><span style={{ color: "#e7e7e7", borderBottom: "1px solid #e7e7e7", paddingBottom: 4 }}>TERMINAL</span>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 36, bottom: 0 }}>{panel}</div>
        </div>
      )}
      {/* status bar */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: STATUS_H, background: C.status, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", fontSize: 13, color: C.dim, gap: 22, padding: "0 14px" }}>
        <span>⎇ main</span><span>⊗ 0 ⚠ 0</span>
        <span style={{ flex: 1 }} />
        <span id="status-rh" style={{ color: "#39d98a", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "rabbithole-icons", fontSize: 16 }}>{""}</span>{status.trim()}
        </span>
        <span>Ln 12, Col 1</span><span>UTF-8</span><span>{statusLang}</span>
      </div>
    </div>
  )
}

/** Where the status bar's Rabbit Hole item sits (world). */
export const STATUS_ITEM = { x: WIN.x + WIN.w - 395, y: WIN.y + WIN.h - STATUS_H / 2 }
