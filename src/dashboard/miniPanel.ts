import * as vscode from "vscode"

function nonce(): string {
  let text = ""
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  for (let i = 0; i < 32; i++) text += chars[Math.floor(Math.random() * chars.length)]
  return text
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export interface MiniUpdateData {
  activeTime: number   // ms
  streak: number
  linesAdded: number
  linesDeleted: number
  topLanguage: string
  sessionCount: number
  isTracking: boolean
  projectActiveTimes: Record<string, number>
  projectNames: Record<string, string>
}

export class MiniPanel implements vscode.WebviewViewProvider {
  static readonly viewId = "rabbithole.miniView"

  private _view?: vscode.WebviewView
  private onReady?: () => void

  constructor(private readonly extensionUri: vscode.Uri) {}

  setOnReady(cb: () => void): void {
    this.onReady = cb
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    webviewView.webview.html = this.getHtml(webviewView.webview)

    // Wait for the webview JS to signal it's ready before sending data
    webviewView.webview.onDidReceiveMessage(msg => {
      const m = msg as { type: string }
      if (m.type === "ready") {
        this.onReady?.()
      } else if (m.type === "openDashboard") {
        vscode.commands.executeCommand("rabbithole.openDashboard")
      }
    })
  }

  update(data: MiniUpdateData): void {
    if (!this._view) return
    this._view.webview.postMessage({
      type: "update",
      time: formatDuration(data.activeTime),
      streak: data.streak,
      linesAdded: data.linesAdded,
      linesDeleted: data.linesDeleted,
      topLanguage: data.topLanguage,
      sessionCount: data.sessionCount,
      isTracking: data.isTracking,
      projectActiveTimes: data.projectActiveTimes,
      projectNames: data.projectNames,
    })
  }

  private getHtml(webview: vscode.Webview): string {
    const n = nonce()
    const fontBase = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "fonts")
    )
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${n}';">
  <style>
    @font-face {
      font-family: 'Press Start 2P';
      src: url('${fontBase}/PressStart2P.woff2') format('woff2');
      font-weight: normal; font-style: normal;
    }
    @font-face {
      font-family: 'Electrolize';
      src: url('${fontBase}/Electrolize-Regular.ttf') format('truetype');
      font-weight: normal; font-style: normal;
    }
    @font-face {
      font-family: 'Unica One';
      src: url('${fontBase}/UnicaOne-Regular.woff2') format('woff2');
      font-weight: normal; font-style: normal;
    }
    /* DESIGN.md retro-terminal tokens — standalone webview, so the values
       are mirrored from src/webview/style.css :root. Keep in sync. */
    :root {
      --rh-void: #06090a;
      --rh-surface-raised: #101613;
      --rh-card-bg: color-mix(in srgb, var(--rh-surface-raised), black 14%);
      --rh-border: #1e2b25;
      --rh-border-bright: #2c4436;
      --rh-text: #dcfbe6;
      --rh-text-dim: #86a596;
      --rh-success: #39ff6a;
      --rh-success-rgb: 57, 255, 106;
      --rh-success-light: #8effab;
      --rh-on-success: #06210e;
      --rh-danger-rgb: 255, 92, 92;
      --rh-glow-text: 0 0 1px currentColor, 0 0 1.5px color-mix(in srgb, currentColor 70%, transparent);
      --rh-glow-text-strong: 0 0 1px currentColor, 0 0 1.5px currentColor,
        0 0 5px color-mix(in srgb, currentColor 80%, transparent);
      --rh-glow-success: 0 0 10px rgba(var(--rh-success-rgb), 0.3), 0 0 36px rgba(var(--rh-success-rgb), 0.15);
      --rh-font-display: 'Press Start 2P', monospace;
      --rh-font-label: 'Electrolize', sans-serif;
      --rh-font-stat: 'Unica One', sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    /* Sits on the host sidebar background (not the dashboard's void) so the
       panel blends into the Activity Bar; phosphor accents + glows on top. */
    body {
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground));
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      text-shadow: var(--rh-glow-text);
      padding: 12px;
    }
    .streak-row {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 14px;
    }
    .streak-number {
      font-family: var(--rh-font-display);
      font-size: 2em;
      font-weight: 700;
      line-height: 1;
      color: var(--rh-success);
      text-shadow: var(--rh-glow-text-strong);
    }
    .streak-label {
      font-family: var(--rh-font-label);
      font-size: 0.8em;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--rh-text-dim);
    }
    .divider {
      height: 1px;
      background: var(--rh-border);
      margin-bottom: 12px;
    }
    .stat {
      margin-bottom: 10px;
    }
    .stat-label {
      font-family: var(--rh-font-label);
      font-size: 0.75em;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--rh-text-dim);
      margin-bottom: 2px;
    }
    .stat-value {
      font-family: var(--rh-font-stat);
      font-size: 1.15em;
      font-weight: 600;
    }
    .add { color: rgba(var(--rh-success-rgb), 0.9); }
    .del { color: rgba(var(--rh-danger-rgb), 0.9); margin-left: 6px; }
    /* Solid light-green fill with phosphor bloom; near-black text
       (--rh-on-success) since white fails contrast on bright green */
    .open-btn {
      width: 100%;
      margin-top: 14px;
      padding: 6px 0;
      background: var(--rh-success-light);
      color: var(--rh-on-success);
      font-weight: 700;
      border: 1px solid var(--rh-success);
      border-radius: 5px;
      font-family: var(--rh-font-label);
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      text-shadow: none;
      box-shadow: var(--rh-glow-success);
      transition: background 0.12s, box-shadow 0.12s;
    }
    .open-btn:hover {
      background: var(--rh-success);
      box-shadow: 0 0 12px rgba(var(--rh-success-rgb), 0.45), 0 0 40px rgba(var(--rh-success-rgb), 0.2);
    }
    .tracking {
      color: var(--rh-success);
      text-shadow: var(--rh-glow-text-strong);
    }
    .project-chart-section { margin-top: 14px; }
    .project-chart-row {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .donut-wrap { flex-shrink: 0; }
    .donut-wrap svg {
      filter: drop-shadow(0 0 3px rgba(var(--rh-success-rgb), 0.25));
    }
    .project-legend { flex: 1; min-width: 0; }
    .legend-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 5px;
      font-size: 0.78em;
      overflow: hidden;
    }
    .legend-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .legend-name {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .legend-time {
      font-family: var(--rh-font-stat);
      color: var(--rh-text-dim);
      white-space: nowrap;
      font-size: 1em;
    }
  </style>
</head>
<body>
  <div class="streak-row">
    <span>&#x1F525;</span>
    <span class="streak-number" id="streak">—</span>
    <span class="streak-label">day streak</span>
  </div>
  <div class="divider"></div>
  <div class="stat">
    <div class="stat-label">Active Today</div>
    <div class="stat-value" id="time">—</div>
  </div>
  <div class="stat">
    <div class="stat-label">Line Changes Today</div>
    <div class="stat-value">
      <span class="add" id="added">—</span>
      <span class="del" id="deleted"></span>
    </div>
  </div>
  <div class="project-chart-section" id="project-chart-section" style="display:none">
    <div class="divider" style="margin-bottom:10px"></div>
    <div class="stat-label" style="margin-bottom:8px">Projects Today</div>
    <div class="project-chart-row">
      <div class="donut-wrap">
        <svg id="donut-svg" width="72" height="72" viewBox="0 0 72 72"></svg>
      </div>
      <div class="project-legend" id="project-legend"></div>
    </div>
  </div>
  <button class="open-btn" id="open-btn">Open Dashboard &#x2197;</button>
  <script nonce="${n}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'openDashboard' });
    });

    // Phosphor palette — mirrors projectColors() in src/webview/charts.ts
    // (accent/info/success + alpha variants) so slices match the main
    // project chart. Keep in sync.
    const COLORS = [
      '#ffb703', '#4fd8ff', '#39ff6a',
      'rgba(255,183,3,0.55)', 'rgba(79,216,255,0.55)', 'rgba(57,255,106,0.55)',
      'rgba(255,183,3,0.8)', 'rgba(79,216,255,0.8)'
    ];

    function formatDur(ms) {
      const m = Math.floor(ms / 60000);
      const h = Math.floor(m / 60);
      return h > 0 ? h + 'h ' + (m % 60) + 'm' : m + 'm';
    }

    function polarToXY(cx, cy, r, angleDeg) {
      const rad = (angleDeg - 90) * Math.PI / 180;
      return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    }

    function arcPath(cx, cy, r, startDeg, endDeg) {
      const s = polarToXY(cx, cy, r, startDeg);
      const e = polarToXY(cx, cy, r, endDeg);
      const large = (endDeg - startDeg) > 180 ? 1 : 0;
      return \`M \${s.x} \${s.y} A \${r} \${r} 0 \${large} 1 \${e.x} \${e.y}\`;
    }

    function renderDonut(projectActiveTimes, projectNames) {
      const section = document.getElementById('project-chart-section');
      const svg = document.getElementById('donut-svg');
      const legend = document.getElementById('project-legend');

      const entries = Object.entries(projectActiveTimes)
        .map(([id, ms]) => ({ id, ms, name: projectNames[id] || id }))
        .filter(e => e.ms > 0)
        .sort((a, b) => b.ms - a.ms);

      if (entries.length < 2) { section.style.display = 'none'; return; }
      section.style.display = '';

      const total = entries.reduce((s, e) => s + e.ms, 0);
      const cx = 36, cy = 36, r = 28, inner = 18;
      svg.innerHTML = '';

      let angle = 0;
      entries.forEach((e, i) => {
        const slice = (e.ms / total) * 360;
        const end = angle + slice;
        const color = COLORS[i % COLORS.length];

        // Outer arc
        const outerPath = arcPath(cx, cy, r, angle, end - 0.5);
        // Inner arc (reversed)
        const iS = polarToXY(cx, cy, inner, end - 0.5);
        const iE = polarToXY(cx, cy, inner, angle);
        const large = slice > 180 ? 1 : 0;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d',
          outerPath +
          \` L \${iS.x} \${iS.y} A \${inner} \${inner} 0 \${large} 0 \${iE.x} \${iE.y} Z\`
        );
        path.setAttribute('fill', color);
        svg.appendChild(path);
        angle = end;
      });

      legend.innerHTML = entries.slice(0, 5).map((e, i) =>
        \`<div class="legend-row">
          <div class="legend-dot" style="background:\${COLORS[i % COLORS.length]}"></div>
          <span class="legend-name">\${e.name}</span>
          <span class="legend-time">\${formatDur(e.ms)}</span>
        </div>\`
      ).join('');
    }

    window.addEventListener('message', e => {
      const d = e.data;
      if (d.type !== 'update') return;
      const timeEl = document.getElementById('time');
      timeEl.textContent = d.time;
      timeEl.className = 'stat-value' + (d.isTracking ? ' tracking' : '');
      document.getElementById('streak').textContent = d.streak;
      document.getElementById('added').textContent = '+' + d.linesAdded;
      document.getElementById('deleted').textContent = '-' + d.linesDeleted;
      if (d.projectActiveTimes) renderDonut(d.projectActiveTimes, d.projectNames || {});
    });

    window.addEventListener('DOMContentLoaded', () => {
      vscode.postMessage({ type: 'ready' });
    });
  </script>
</body>
</html>`
  }
}
