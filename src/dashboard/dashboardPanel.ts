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
      <div class="sidebar-header">
        <button id="sidebar-toggle" title="Toggle navigation">&#x2630;</button>
        <div class="sidebar-wordmark">Rabbit Hole</div>
      </div>
      <div id="nav-items">
        <button class="nav-item active" data-tab="overview">
          <span class="nav-icon">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.5 7L8 1.5L14.5 7V14.5H10V10H6V14.5H1.5V7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="nav-label">Overview</span>
        </button>
        <button class="nav-item" data-tab="projects">
          <span class="nav-icon">&#x229E;</span>
          <span class="nav-label">Projects</span>
        </button>
        <div class="nav-spacer"></div>
        <div class="nav-divider"></div>
        <button class="nav-item" data-tab="settings">
          <span class="nav-icon">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.5 1.5H9.5L10 3.3C10.6 3.6 11.1 3.9 11.5 4.3L13.3 3.7L14.8 6.3L13.4 7.5C13.5 7.7 13.5 7.8 13.5 8C13.5 8.2 13.5 8.3 13.4 8.5L14.8 9.7L13.3 12.3L11.5 11.7C11.1 12.1 10.6 12.4 10 12.7L9.5 14.5H6.5L6 12.7C5.4 12.4 4.9 12.1 4.5 11.7L2.7 12.3L1.2 9.7L2.6 8.5C2.5 8.3 2.5 8.2 2.5 8C2.5 7.8 2.5 7.7 2.6 7.5L1.2 6.3L2.7 3.7L4.5 4.3C4.9 3.9 5.4 3.6 6 3.3L6.5 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
              <circle cx="8" cy="8" r="2.3" stroke="currentColor" stroke-width="1.4"/>
            </svg>
          </span>
          <span class="nav-label">Settings</span>
        </button>
      </div>
    </nav>

    <main id="content">
      <div id="header">
        <div id="streak-pill">&#x1F525; <span id="streak-count">0</span> <span class="streak-label">day streak</span><span id="streak-target"></span></div>
        <button id="export-pdf-btn" class="export-pdf-btn">&#x2197; Export Card</button>
      </div>

      <div id="filter-bar">
        <div class="filter-range">
          <button class="filter-btn active" data-preset="today">Today</button>
          <button class="filter-btn" data-preset="7d">7d</button>
          <button class="filter-btn" data-preset="30d">30d</button>
          <button class="filter-btn" data-preset="1y">1Y</button>
          <button class="filter-btn" data-preset="custom">Custom</button>
        </div>
        <div id="custom-range" class="hidden">
          <input type="date" id="custom-start">
          <span class="custom-range-sep">&#x2013;</span>
          <input type="date" id="custom-end">
        </div>
        <div id="project-filter" class="proj-filter">
          <button id="proj-filter-btn" class="proj-filter-btn">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M1 2.5h10L7.5 6.5v4l-3-1.5V6.5L1 2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            </svg>
            <span id="proj-filter-label">Choose Project</span>
          </button>
          <div id="proj-dropdown-panel" class="proj-dropdown-panel hidden"></div>
        </div>
      </div>

      <!-- Overview: full dashboard grid -->
      <div class="tab-panel active" id="tab-overview">
        <div class="stat-group">
          <div class="stat-item accent-time"><div class="stat-label">Active Time</div><div class="stat-value" id="stat-time">&#x2014;</div></div>
          <div class="stat-item accent-add"><div class="stat-label">Lines Added</div><div class="stat-value" id="stat-added">&#x2014;</div></div>
          <div class="stat-item accent-del"><div class="stat-label">Lines Deleted</div><div class="stat-value" id="stat-deleted">&#x2014;</div></div>
        </div>
        <div class="overview-grid">
          <div id="heatmap" class="section-card">
            <div class="widget-header">
              <div class="widget-header-info">
                <div class="widget-title">Activity Heatmap</div>
                <div class="widget-subtitle">Daily active time</div>
              </div>
            </div>
            <div id="heatmap-canvas"></div>
          </div>
          <div class="chart-box">
            <div class="widget-header">
              <div class="widget-header-info">
                <div class="widget-title">Code Changes</div>
                <div class="widget-subtitle">Lines added and deleted per day</div>
              </div>
            </div>
            <canvas id="lines-chart"></canvas>
          </div>
          <div class="chart-box lang-chart-box">
            <div class="widget-header">
              <div class="widget-header-info">
                <div class="widget-title">Languages</div>
                <div class="widget-subtitle">Time and lines changed by language</div>
              </div>
              <div class="widget-header-controls">
                <div class="toggle-group" id="lang-metric">
                  <button class="toggle-btn active" data-val="time">Time</button>
                  <button class="toggle-btn" data-val="lines">Lines</button>
                </div>
              </div>
            </div>
            <canvas id="lang-chart"></canvas>
            <div id="lang-legend"></div>
          </div>
          <div id="sessions-panel" class="section-card">
            <div class="widget-header">
              <div class="widget-header-info">
                <div class="widget-title">Sessions</div>
                <div class="widget-subtitle">Start and end times per coding session</div>
              </div>
            </div>
            <div id="sessions-list"></div>
          </div>
          <div id="files-panel" class="section-card full-width">
            <div class="widget-header">
              <div class="widget-header-info">
                <div class="widget-title">Changed Files</div>
                <div class="widget-subtitle">Most modified files by change volume</div>
              </div>
            </div>
            <div id="files-list"></div>
          </div>
          <div id="projects-mini" class="section-card full-width">
            <div class="widget-header">
              <div class="widget-header-info">
                <div class="widget-title">Projects</div>
                <div class="widget-subtitle">Active projects by coding time</div>
              </div>
            </div>
            <div id="projects-mini-list"></div>
          </div>
        </div>
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

      <!-- Projects: summary cards -->
      <div class="tab-panel" id="tab-projects">
        <div class="projects-tab-header">
          <div class="toggle-group" id="sort-toggle">
            <button class="toggle-btn active" data-val="time">Active Time</button>
            <button class="toggle-btn" data-val="last">Last Active</button>
            <button class="toggle-btn" data-val="name">Name</button>
          </div>
        </div>
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
