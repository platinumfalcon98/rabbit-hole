import * as vscode from "vscode"
import { ExtensionMessage } from "../shared/types"

export class DashboardPanel {
  static currentPanel: DashboardPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly extensionUri: vscode.Uri
  private disposables: vscode.Disposable[] = []

  static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      "rabbitHoleDashboard",
      "Rabbit Hole",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "out"),
        ],
      }
    )

    DashboardPanel.currentPanel = new DashboardPanel(panel, context.extensionUri)
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel
    this.extensionUri = extensionUri

    this.panel.webview.html = this.getHtmlContent()

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
  }

  dispose(): void {
    DashboardPanel.currentPanel = undefined
    this.panel.dispose()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }

  postMessage(message: ExtensionMessage): void {
    this.panel.webview.postMessage(message)
  }

  onMessage(handler: (msg: unknown) => void): void {
    this.panel.webview.onDidReceiveMessage(handler, null, this.disposables)
  }

  private getHtmlContent(): string {
    const webview = this.panel.webview

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "main.js")
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "style.css")
    )

    const cspSource = webview.cspSource

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Rabbit Hole</title>
</head>
<body>
  <div id="app">

    <nav id="sidebar">
      <button id="sidebar-toggle" title="Toggle navigation">&#x2630;</button>
      <div class="sidebar-wordmark">Rabbit Hole</div>
      <div id="nav-items">
        <button class="nav-item active" data-tab="overview">
          <span class="nav-icon">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="6.5" cy="6.5" r="2" fill="currentColor"/>
              <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </span>
          <span class="nav-label">Overview</span>
        </button>
        <button class="nav-item" data-tab="activity">
          <span class="nav-icon">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polyline points="1,13 5,8 9,10 13,4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="10,3 13,3 13,6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="nav-label">Activity</span>
        </button>
        <button class="nav-item" data-tab="code">
          <span class="nav-icon">&lt;/&gt;</span>
          <span class="nav-label">Code</span>
        </button>
        <button class="nav-item" data-tab="projects">
          <span class="nav-icon">&#x229E;</span>
          <span class="nav-label">Projects</span>
        </button>
        <div class="nav-spacer"></div>
        <button class="nav-item" data-tab="settings">
          <span class="nav-icon">&#x2699;</span>
          <span class="nav-label">Settings</span>
        </button>
      </div>
    </nav>

    <main id="content">
      <div id="header">
        <div id="streak-pill">&#x1F525; <span id="streak-count">0</span> <span class="streak-label">day streak</span><span id="streak-target"></span></div>
        <div class="toggle-group" id="range-toggle">
          <button class="toggle-btn" data-val="7">7d</button>
          <button class="toggle-btn active" data-val="30">30d</button>
          <button class="toggle-btn" data-val="90">90d</button>
        </div>
      </div>

      <!-- Overview: stat cards + heatmap -->
      <div class="tab-panel active" id="tab-overview">
        <div class="overview-header">
          <button id="export-pdf-btn" class="export-pdf-btn">&#x2197; Export Card</button>
        </div>
        <div id="stat-cards">
          <div class="stat-card accent-time"><div class="stat-label">Active Time</div><div class="stat-value" id="stat-time">&#x2014;</div></div>
          <div class="stat-card accent-add"><div class="stat-label">Lines Added</div><div class="stat-value" id="stat-added">&#x2014;</div></div>
          <div class="stat-card accent-del"><div class="stat-label">Lines Deleted</div><div class="stat-value" id="stat-deleted">&#x2014;</div></div>
        </div>
        <div id="heatmap"></div>
      </div>

      <!-- PDF export modal -->
      <div id="pdf-modal-overlay" class="modal-overlay hidden">
        <div class="modal">
          <h2 class="modal-title">Export Card</h2>

          <div class="modal-section">
            <div class="modal-label">Date Range</div>
            <div class="toggle-group" id="pdf-range">
              <button class="toggle-btn" data-val="7">7 days</button>
              <button class="toggle-btn active" data-val="30">30 days</button>
              <button class="toggle-btn" data-val="90">90 days</button>
            </div>
          </div>

          <div class="modal-section">
            <div class="modal-label">Include</div>
            <div class="modal-checks">
              <label class="modal-check"><input type="checkbox" id="pdf-streak" checked> Streak</label>
              <label class="modal-check"><input type="checkbox" id="pdf-active-time" checked> Active Time</label>
              <label class="modal-check"><input type="checkbox" id="pdf-lines-added" checked> Lines Added</label>
              <label class="modal-check"><input type="checkbox" id="pdf-lines-deleted" checked> Lines Deleted</label>
              <label class="modal-check"><input type="checkbox" id="pdf-top-lang" checked> Top Language</label>
              <label class="modal-check"><input type="checkbox" id="pdf-heatmap" checked> Activity Heatmap</label>
            </div>
          </div>

          <div class="modal-actions">
            <button id="pdf-cancel" class="modal-btn-secondary">Cancel</button>
            <button id="pdf-generate" class="modal-btn-primary">Generate PDF</button>
          </div>
        </div>
      </div>

      <!-- Activity: lines chart + sessions -->
      <div class="tab-panel" id="tab-activity">
        <div class="chart-grid">
          <div class="chart-box chart-wide"><canvas id="lines-chart"></canvas></div>
        </div>
        <div id="sessions-panel">
          <h2 class="section-title">Sessions</h2>
          <div id="sessions-list"></div>
        </div>
      </div>

      <!-- Code: language panel + files -->
      <div class="tab-panel" id="tab-code">
        <div class="chart-grid">
          <div class="chart-box chart-wide lang-chart-box">
            <div class="chart-panel-header">
              <div class="toggle-group" id="lang-chart-type">
                <button class="toggle-btn active" data-val="bar">Bar</button>
                <button class="toggle-btn" data-val="donut">Donut</button>
              </div>
              <div class="toggle-group" id="lang-metric">
                <button class="toggle-btn active" data-val="time">Time</button>
                <button class="toggle-btn" data-val="lines">Lines</button>
              </div>
            </div>
            <canvas id="lang-chart"></canvas>
            <div id="lang-legend"></div>
          </div>
        </div>
        <div id="files-panel">
          <h2 class="section-title">Files</h2>
          <div id="files-list"></div>
        </div>
      </div>

      <!-- Projects: filter chips + summary cards -->
      <div class="tab-panel" id="tab-projects">
        <div id="project-filter"></div>
        <div id="project-cards"></div>
      </div>

      <!-- Settings: user preferences -->
      <div class="tab-panel" id="tab-settings">
        <div class="settings-section">
          <h3 class="settings-section-title">Tracking</h3>
          <div class="setting-row">
            <div class="setting-meta">
              <label class="setting-label" for="pref-daily-target">Daily target</label>
              <div class="setting-desc">Streak only increments on days meeting this target. Leave empty for any activity.</div>
            </div>
            <div class="setting-control">
              <input type="number" id="pref-daily-target" class="setting-input" min="0" max="1440" placeholder="unset">
              <span class="setting-unit">min</span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-meta">
              <label class="setting-label" for="pref-idle-threshold">Idle threshold</label>
              <div class="setting-desc">Minutes of inactivity before the active timer pauses.</div>
            </div>
            <div class="setting-control">
              <input type="number" id="pref-idle-threshold" class="setting-input" min="1" max="60">
              <span class="setting-unit">min</span>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-meta">
              <label class="setting-label" for="pref-session-expiry">Session expiry</label>
              <div class="setting-desc">Minutes away before a paused session closes and a new one starts on return.</div>
            </div>
            <div class="setting-control">
              <input type="number" id="pref-session-expiry" class="setting-input" min="1" max="480">
              <span class="setting-unit">min</span>
            </div>
          </div>
        </div>

      </div>

    </main>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`
  }
}
