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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Rabbit Hole</title>
</head>
<body>
  <div id="app">

    <nav id="sidebar" class="collapsed">
      <div class="sidebar-header">
        <button id="sidebar-toggle" title="Toggle navigation">
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="9" y="3" width="1" height="1" fill="#FF8B00"/>
<rect x="8" y="3" width="1" height="1" fill="#FF8B00"/>
<rect x="10" y="5" width="1" height="1" fill="#FF8B00"/>
<rect x="10" y="4" width="1" height="1" fill="#FF8B00"/>
<rect x="7" y="3" width="1" height="1" fill="#FF8B00"/>
<rect x="6" y="3" width="1" height="1" fill="#FF8B00"/>
<path d="M4 4H6V5H4V4Z" fill="#A5510C"/>
<rect x="4" y="5" width="1" height="1" fill="#FF8B00"/>
<rect x="3" y="6" width="1" height="1" fill="#FF8B00"/>
<rect x="2" y="7" width="1" height="1" fill="#FF8B00"/>
<rect x="1" y="8" width="1" height="1" fill="#FF8B00"/>
<rect x="9" y="6" width="1" height="1" fill="#FF8B00"/>
<rect x="8" y="7" width="1" height="1" fill="#FF8B00"/>
<path d="M7 8H9V9H7V8Z" fill="#A5510C"/>
<rect x="6" y="8" width="1" height="1" fill="#FF8B00"/>
<rect x="4" y="8" width="1" height="1" fill="#FF8B00"/>
<rect x="2" y="8" width="1" height="1" fill="#FF8B00"/>
<rect x="3" y="8" width="1" height="1" fill="#FF8B00"/>
<rect x="5" y="8" width="1" height="1" fill="#FF8B00"/>
<rect x="3" y="7" width="1" height="1" fill="#FF8B00"/>
<rect x="4" y="7" width="1" height="1" fill="#FF8B00"/>
<rect x="5" y="6" width="1" height="1" fill="#FF8B00"/>
<rect x="4" y="6" width="1" height="1" fill="#FF8B00"/>
<rect x="5" y="7" width="1" height="1" fill="#FF8B00"/>
<rect x="6" y="7" width="1" height="1" fill="#A5510C"/>
<rect x="5" y="5" width="1" height="1" fill="#FF8B00"/>
<rect x="6" y="5" width="1" height="1" fill="#A5510C"/>
<rect x="6" y="4" width="1" height="1" fill="#FF8B00"/>
<rect x="7" y="5" width="1" height="1" fill="#FF8B00"/>
<rect x="7" y="6" width="1" height="1" fill="#FF8B00"/>
<rect x="7" y="7" width="1" height="1" fill="#FF8B00"/>
<rect x="6" y="6" width="1" height="1" fill="#FF8B00"/>
<rect x="8" y="6" width="1" height="1" fill="#FF8B00"/>
<rect x="8" y="5" width="1" height="1" fill="#FF8B00"/>
<rect x="9" y="5" width="1" height="1" fill="#FF8B00"/>
<rect x="9" y="4" width="1" height="1" fill="#FF8B00"/>
<rect x="8" y="4" width="1" height="1" fill="#FF8B00"/>
<rect x="7" y="4" width="1" height="1" fill="#FF8B00"/>
<rect x="12" y="1" width="1" height="1" fill="#01FF00"/>
<rect x="11" y="2" width="1" height="1" fill="#01FF00"/>
<rect x="10" y="3" width="1" height="1" fill="#01FF00"/>
<rect x="11" y="4" width="1" height="1" fill="#01FF00"/>
<rect x="12" y="4" width="1" height="1" fill="#01FF00"/>
<rect x="13" y="4" width="1" height="1" fill="#01FF00"/>
<rect x="9" y="2" width="1" height="1" fill="#01FF00"/>
<rect x="9" y="1" width="1" height="1" fill="#01FF00"/>
<rect x="9" width="1" height="1" fill="#01FF00"/>
<rect x="5" y="3" width="1" height="1" fill="#A5510C"/>
<path d="M6 2H9V3H6V2Z" fill="#A5510C"/>
<rect x="3" y="5" width="1" height="1" fill="#A5510C"/>
<rect x="2" y="6" width="1" height="1" fill="#A5510C"/>
<rect x="1" y="7" width="1" height="1" fill="#A5510C"/>
<path d="M0 9H8V10H0V9Z" fill="#A5510C"/>
<rect x="9" y="7" width="1" height="1" fill="#A5510C"/>
<rect x="10" y="6" width="1" height="1" fill="#A5510C"/>
<path d="M10 4H11V6H10V4Z" fill="#A5510C"/>
<rect x="9" y="3" width="1" height="1" fill="#A5510C"/>
</svg>

        </button>
      </div>
      <div id="nav-items">
        <button class="nav-item active" data-tab="overview">
          <span class="nav-icon">
            <svg width="22" height="15" viewBox="0 0 22 15" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M11 4.5C10.2044 4.5 9.44129 4.81607 8.87868 5.37868C8.31607 5.94129 8 6.70435 8 7.5C8 8.29565 8.31607 9.05871 8.87868 9.62132C9.44129 10.1839 10.2044 10.5 11 10.5C11.7956 10.5 12.5587 10.1839 13.1213 9.62132C13.6839 9.05871 14 8.29565 14 7.5C14 6.70435 13.6839 5.94129 13.1213 5.37868C12.5587 4.81607 11.7956 4.5 11 4.5ZM11 12.5C9.67392 12.5 8.40215 11.9732 7.46447 11.0355C6.52678 10.0979 6 8.82608 6 7.5C6 6.17392 6.52678 4.90215 7.46447 3.96447C8.40215 3.02678 9.67392 2.5 11 2.5C12.3261 2.5 13.5979 3.02678 14.5355 3.96447C15.4732 4.90215 16 6.17392 16 7.5C16 8.82608 15.4732 10.0979 14.5355 11.0355C13.5979 11.9732 12.3261 12.5 11 12.5ZM11 0C6 0 1.73 3.11 0 7.5C1.73 11.89 6 15 11 15C16 15 20.27 11.89 22 7.5C20.27 3.11 16 0 11 0Z" fill="currentColor"/>
</svg>

          </span>
          <span class="nav-label">Overview</span>
        </button>
        <button class="nav-item" data-tab="activity">
          <span class="nav-icon">
            <svg width="20" height="16" viewBox="0 0 20 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M16.035 0H0V5.938H1.545L3.617 2.788L5.469 6.288L6.276 5.062H10.507C10.8794 3.96157 11.662 3.04728 12.6918 2.50963C13.7217 1.97199 14.9192 1.85248 16.035 2.176V0ZM10.307 7.063H7.354L5.281 10.21L3.43 6.71L2.623 7.936H0V13H7.017V14H5.011C4.74578 14 4.49143 14.1054 4.30389 14.2929C4.11636 14.4804 4.011 14.7348 4.011 15C4.011 15.2652 4.11636 15.5196 4.30389 15.7071C4.49143 15.8946 4.74578 16 5.011 16H11.024C11.2892 16 11.5436 15.8946 11.7311 15.7071C11.9186 15.5196 12.024 15.2652 12.024 15C12.024 14.7348 11.9186 14.4804 11.7311 14.2929C11.5436 14.1054 11.2892 14 11.024 14H9.017V13H16.035V10.824C15.6277 10.9414 15.2059 11.0006 14.782 11C13.6848 11.0004 12.6252 10.6008 11.8014 9.87609C10.9777 9.15139 10.4464 8.15126 10.307 7.063Z" fill="currentColor"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M17.8674 8.166C18.155 7.63219 18.2992 7.03287 18.2858 6.42665C18.2724 5.82044 18.1019 5.22807 17.791 4.70746C17.4802 4.18686 17.0395 3.75585 16.5121 3.45656C15.9848 3.15728 15.3888 2.99996 14.7824 3C14.3223 2.99948 13.8665 3.08959 13.4412 3.2652C13.0159 3.4408 12.6293 3.69847 12.3035 4.02347C11.9778 4.34848 11.7192 4.73446 11.5427 5.15938C11.3661 5.58431 11.2749 6.03985 11.2744 6.5C11.2744 8.433 12.8444 10 14.7824 10C15.3655 10.001 15.9395 9.85624 16.4524 9.579L18.5834 11.706L20.0004 10.294L17.8674 8.166ZM14.7824 8C15.6184 8 16.2894 7.324 16.2894 6.5C16.2894 5.676 15.6204 5 14.7824 5C13.9444 5 13.2744 5.676 13.2744 6.5C13.2744 7.324 13.9454 8 14.7824 8Z" fill="currentColor"/>
</svg>

          </span>
          <span class="nav-label">Activity</span>
        </button>
        <button class="nav-item" data-tab="projects">
          <span class="nav-icon">
            <svg width="19" height="22" viewBox="0 0 19 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 4H18V21H4V4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              <path d="M15 4V1H1.5C1.36739 1 1.24021 1.05268 1.14645 1.14645C1.05268 1.24021 1 1.36739 1 1.5V18H4M8 10H14M8 14H14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="nav-label">Projects</span>
        </button>
        <div class="nav-spacer"></div>
        <div class="nav-divider"></div>
        <button class="nav-item" data-tab="settings">
          <span class="nav-icon">
            <svg width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.3 20L6.9 16.8C6.68333 16.7167 6.47933 16.6167 6.288 16.5C6.09667 16.3833 5.909 16.2583 5.725 16.125L2.75 17.375L0 12.625L2.575 10.675C2.55833 10.5583 2.55 10.446 2.55 10.338V9.663C2.55 9.55433 2.55833 9.44167 2.575 9.325L0 7.375L2.75 2.625L5.725 3.875C5.90833 3.74167 6.1 3.61667 6.3 3.5C6.5 3.38333 6.7 3.28333 6.9 3.2L7.3 0H12.8L13.2 3.2C13.4167 3.28333 13.621 3.38333 13.813 3.5C14.005 3.61667 14.1923 3.74167 14.375 3.875L17.35 2.625L20.1 7.375L17.525 9.325C17.5417 9.44167 17.55 9.55433 17.55 9.663V10.337C17.55 10.4457 17.5333 10.5583 17.5 10.675L20.075 12.625L17.325 17.375L14.375 16.125C14.1917 16.2583 14 16.3833 13.8 16.5C13.6 16.6167 13.4 16.7167 13.2 16.8L12.8 20H7.3ZM9.05 18H11.025L11.375 15.35C11.8917 15.2167 12.371 15.021 12.813 14.763C13.255 14.505 13.659 14.1923 14.025 13.825L16.5 14.85L17.475 13.15L15.325 11.525C15.4083 11.2917 15.4667 11.046 15.5 10.788C15.5333 10.53 15.55 10.2673 15.55 10C15.55 9.73267 15.5333 9.47033 15.5 9.213C15.4667 8.95567 15.4083 8.70967 15.325 8.475L17.475 6.85L16.5 5.15L14.025 6.2C13.6583 5.81667 13.2543 5.496 12.813 5.238C12.3717 4.98 11.8923 4.784 11.375 4.65L11.05 2H9.075L8.725 4.65C8.20833 4.78333 7.72933 4.97933 7.288 5.238C6.84667 5.49667 6.44233 5.809 6.075 6.175L3.6 5.15L2.625 6.85L4.775 8.45C4.69167 8.7 4.63333 8.95 4.6 9.2C4.56667 9.45 4.55 9.71667 4.55 10C4.55 10.2667 4.56667 10.525 4.6 10.775C4.63333 11.025 4.69167 11.275 4.775 11.525L2.625 13.15L3.6 14.85L6.075 13.8C6.44167 14.1833 6.846 14.5043 7.288 14.763C7.73 15.0217 8.209 15.2173 8.725 15.35L9.05 18ZM10.1 13.5C11.0667 13.5 11.8917 13.1583 12.575 12.475C13.2583 11.7917 13.6 10.9667 13.6 10C13.6 9.03333 13.2583 8.20833 12.575 7.525C11.8917 6.84167 11.0667 6.5 10.1 6.5C9.11667 6.5 8.28733 6.84167 7.612 7.525C6.93667 8.20833 6.59933 9.03333 6.6 10C6.60067 10.9667 6.93833 11.7917 7.613 12.475C8.28767 13.1583 9.11667 13.5 10.1 13.5Z" fill="currentColor"/>
            </svg>
          </span>
          <span class="nav-label">Settings</span>
        </button>
      </div>
    </nav>

    <main id="content">
      <div id="header">
        <div id="streak-pill">&#x1F525; <span id="streak-count">0</span> <span class="streak-label">day streak</span><span id="streak-extended" class="streak-extended hidden"> extended</span><span id="streak-target"></span></div>
        <button id="export-pdf-btn" class="export-pdf-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 12L3 7L4.4 5.55L7 8.15V0H9V8.15L11.6 5.55L13 7L8 12ZM2 16C1.45 16 0.979333 15.8043 0.588 15.413C0.196666 15.0217 0.000666667 14.5507 0 14V11H2V14H14V11H16V14C16 14.55 15.8043 15.021 15.413 15.413C15.0217 15.805 14.5507 16.0007 14 16H2Z" fill="currentColor"/>
          </svg>
          Export Card
        </button>
      </div>

      <div id="filter-bar">
        <div id="stat-range-label" class="stat-range-label"></div>
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
            <span id="proj-filter-label">All Projects</span>
          </button>
          <div id="proj-dropdown-panel" class="proj-dropdown-panel hidden">
            <div class="proj-panel-header">Select project</div>
            <div class="proj-panel-list"></div>
            <div class="proj-panel-footer">
              <button class="proj-panel-apply">Apply</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Overview: full dashboard grid -->
      <div class="tab-panel active" id="tab-overview">
        <div class="stat-group">
          <div class="stat-item accent-time"><div class="stat-label">Active Time</div><div class="stat-value" id="stat-time">&#x2014;</div><div class="stat-avg hidden" id="stat-time-avg"></div></div>
          <div class="stat-item accent-add"><div class="stat-label">Lines Added</div><div class="stat-value" id="stat-added">&#x2014;</div><div class="stat-avg hidden" id="stat-added-avg"></div></div>
          <div class="stat-item accent-del"><div class="stat-label">Lines Deleted</div><div class="stat-value" id="stat-deleted">&#x2014;</div><div class="stat-avg hidden" id="stat-deleted-avg"></div></div>
        </div>
        <div class="overview-grid">
          <div class="chart-box">
            <div class="widget-header">
              <div class="widget-header-info">
                <div class="widget-title">LINE CHANGES</div>
                <div class="widget-subtitle">Total lines added vs deleted</div>
              </div>
            </div>
            <canvas id="lines-chart"></canvas>
          </div>
          <div class="chart-box lang-chart-box">
            <div class="widget-header">
              <div class="widget-header-info">
                <div class="widget-title">LANGUAGES</div>
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
                <div class="widget-title">SESSIONS</div>
                <div class="widget-subtitle">Start and end times per coding session</div>
              </div>
              <div class="widget-header-controls">
                <div class="toggle-group" id="sessions-sort">
                  <button class="toggle-btn active" data-val="desc">Latest</button>
                  <button class="toggle-btn" data-val="asc">Oldest</button>
                </div>
              </div>
            </div>
            <div id="sessions-list"></div>
          </div>
          <div id="files-panel" class="section-card full-width">
            <div class="widget-header">
              <div class="widget-header-info">
                <div class="widget-title">CHANGED FILES</div>
                <div class="widget-subtitle">Most modified files by change volume</div>
              </div>
            </div>
            <div id="files-list"></div>
          </div>
          <div id="projects-mini" class="section-card full-width">
            <div class="widget-header">
              <div class="widget-header-info">
                <div class="widget-title">PROJECTS</div>
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

      <!-- Activity: heatmap -->
      <div class="tab-panel" id="tab-activity">
        <div class="activity-tab-header">
          <div id="act-project-filter" class="proj-filter">
            <button id="act-proj-filter-btn" class="proj-filter-btn">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M1 2.5h10L7.5 6.5v4l-3-1.5V6.5L1 2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
              </svg>
              <span id="act-proj-filter-label">All Projects</span>
            </button>
            <div id="act-proj-dropdown-panel" class="proj-dropdown-panel hidden">
              <div class="proj-panel-header">Select project</div>
              <div class="proj-panel-list"></div>
              <div class="proj-panel-footer">
                <button class="proj-panel-apply">Apply</button>
              </div>
            </div>
          </div>
        </div>
        <div class="activity-summary section-card">
          <div class="activity-stats-row">
            <div class="activity-stat">
              <div class="activity-stat-value" id="act-active-days">—</div>
              <div class="activity-stat-label">Active days</div>
            </div>
            <div class="activity-stat-sep"></div>
            <div class="activity-stat">
              <div class="activity-stat-value" id="act-total-time">—</div>
              <div class="activity-stat-label">Total this year</div>
            </div>
            <div class="activity-stat-sep"></div>
            <div class="activity-stat">
              <div class="activity-stat-value" id="act-longest-streak">—</div>
              <div class="activity-stat-label">Longest streak</div>
            </div>
            <div class="activity-stat-sep"></div>
            <div class="activity-stat">
              <div class="activity-stat-value" id="act-best-day">—</div>
              <div class="activity-stat-label">Most active day</div>
            </div>
          </div>
        </div>
        <div id="heatmap" class="section-card">
          <div class="widget-header">
            <div class="widget-header-info">
              <div class="widget-title" id="heatmap-title">Activity</div>
              <div class="widget-subtitle" id="heatmap-subtitle">Daily active time · past year</div>
            </div>
          </div>
          <div id="heatmap-canvas"></div>
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
