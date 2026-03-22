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
    })
  }

  private getHtml(webview: vscode.Webview): string {
    const n = nonce()
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
  <style>
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
      font-size: 2em;
      font-weight: 700;
      line-height: 1;
    }
    .streak-label {
      font-size: 0.8em;
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
      font-size: 0.75em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
    .stat-value {
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
    <div class="stat-label">Lines</div>
    <div class="stat-value">
      <span class="add" id="added">—</span>
      <span class="del" id="deleted"></span>
    </div>
  </div>
  <button class="open-btn" id="open-btn">Open Dashboard &#x2197;</button>
  <script nonce="${n}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'openDashboard' });
    });
    window.addEventListener('message', e => {
      const d = e.data;
      if (d.type !== 'update') return;
      document.getElementById('time').textContent = d.time;
      document.getElementById('streak').textContent = d.streak;
      document.getElementById('added').textContent = '+' + d.linesAdded;
      document.getElementById('deleted').textContent = '-' + d.linesDeleted;
    });
    // Signal ready so the extension can send initial data immediately
    window.addEventListener('DOMContentLoaded', () => {
      vscode.postMessage({ type: 'ready' });
    });
  </script>
</body>
</html>`
  }
}
