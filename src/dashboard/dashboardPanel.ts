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
  <div id="header">
    <h1>Rabbit Hole</h1>
    <div id="streak">&#x1F525; <span id="streak-count">0</span> day streak</div>
    <select id="range">
      <option value="7">Last 7 days</option>
      <option value="30" selected>Last 30 days</option>
      <option value="90">Last 90 days</option>
    </select>
  </div>

  <div id="stat-cards">
    <div class="stat-card"><div class="stat-label">Active Time</div><div class="stat-value" id="stat-time">&#x2014;</div></div>
    <div class="stat-card"><div class="stat-label">Lines Added</div><div class="stat-value" id="stat-added">&#x2014;</div></div>
    <div class="stat-card"><div class="stat-label">Lines Deleted</div><div class="stat-value" id="stat-deleted">&#x2014;</div></div>
    <div class="stat-card"><div class="stat-label">AI Assisted</div><div class="stat-value" id="stat-ai">&#x2014;</div></div>
  </div>

  <div id="heatmap"></div>

  <div class="chart-grid">
    <div class="chart-box"><canvas id="lines-chart"></canvas></div>
    <div class="chart-box lang-chart-box">
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
    <div class="chart-box chart-wide"><canvas id="agent-chart"></canvas></div>
  </div>

  <div id="sessions-panel">
    <h2 class="section-title">Sessions</h2>
    <div id="sessions-list"></div>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`
  }
}
