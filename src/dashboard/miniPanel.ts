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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground));
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      padding: 12px;
    }
    .streak-row {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 14px;
    }
    .streak-number {
      font-family: 'Press Start 2P', monospace;
      font-size: 2em;
      font-weight: 700;
      line-height: 1;
    }
    .streak-label {
      font-family: 'Electrolize', sans-serif;
      font-size: 0.8em;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    .divider {
      height: 1px;
      background: var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
      margin-bottom: 12px;
    }
    .stat {
      margin-bottom: 10px;
    }
    .stat-label {
      font-family: 'Electrolize', sans-serif;
      font-size: 0.75em;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
    .stat-value {
      font-family: 'Unica One', sans-serif;
      font-size: 1.15em;
      font-weight: 600;
    }
    .add { color: rgba(46, 204, 113, 0.9); }
    .del { color: rgba(231, 76, 60, 0.9); margin-left: 6px; }
    .open-btn {
      width: 100%;
      margin-top: 14px;
      padding: 6px 0;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      font-family: var(--vscode-font-family);
      font-size: 0.85em;
      cursor: pointer;
    }
    .open-btn:hover { background: var(--vscode-button-hoverBackground); }
    .tracking { color: #22c55e; }
    .project-chart-section { margin-top: 14px; }
    .project-chart-row {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .donut-wrap { flex-shrink: 0; }
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
      color: var(--vscode-editor-foreground);
    }
    .legend-time {
      font-family: 'Unica One', sans-serif;
      color: white;
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

    const COLORS = [
      '#f97316','#22c55e','#3b82f6',
      '#a855f7','#eab308','#ec4899',
      '#14b8a6','#f43f5e'
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
