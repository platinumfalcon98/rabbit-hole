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
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "rabbithole-icon.svg")

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
    const asset = (...path: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webview", ...path))
    const scriptUri = asset("main.js")
    const styleUri = asset("style.css")
    const fontUri = asset("fonts", "MartianMono-VF.woff2")
    const cspSource = webview.cspSource

    // Every fieldset is static: modules re-render only what is inside them, so
    // hover focus can keep track of the panel under the pointer.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @font-face { font-family: "Martian Mono"; src: url("${fontUri}") format("woff2"); font-weight: 100 800; font-stretch: 75% 112.5%; font-display: block; }
  </style>
  <link rel="stylesheet" href="${styleUri}">
  <title>Rabbit Hole</title>
</head>
<body>
<div class="screen">
  <header class="bar">
    <span class="brand" id="brand" title="Rabbit Hole"></span>
    <div class="projpick">
      <button class="proj" id="proj-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Project shown"><i class="key hollow" id="proj-key"></i><span id="proj-name">all projects</span><span class="caret">▾</span></button>
      <div class="pmenu" id="pmenu" role="listbox" aria-label="Project" hidden></div>
    </div>
    <nav class="tabs" id="tabs" aria-label="Dashboard sections">
      <button data-tab="overview" aria-pressed="true">overview</button><button data-tab="activity" aria-pressed="false">activity</button><button data-tab="projects" aria-pressed="false">projects</button><button data-tab="settings" aria-pressed="false">settings</button>
    </nav>
    <span class="spacer"></span>
    <div class="range" id="range" role="group" aria-label="Date range">
      <button data-range="today" aria-pressed="true">today</button><button data-range="yday" aria-pressed="false">yesterday</button><button data-range="7d" aria-pressed="false">7d</button><button data-range="30d" aria-pressed="false">30d</button><button id="r-cal" aria-haspopup="dialog" aria-expanded="false" aria-pressed="false">pick…</button>
    </div>
    <div class="picker" id="picker" role="dialog" aria-label="Pick a date range" hidden>
      <div class="pk-head">
        <button class="btn step" id="pk-prev" aria-label="Earlier months">‹</button>
        <span class="hint">click a start day, then an end day</span>
        <span class="spacer"></span>
        <button class="btn step" id="pk-next" aria-label="Later months">›</button>
      </div>
      <div class="pk-months" id="pk-months"></div>
      <div class="pk-foot">
        <span id="pk-sel"></span><span class="spacer"></span>
        <button class="btn" id="pk-cancel">cancel</button><button class="btn" id="pk-apply" disabled>apply</button>
      </div>
    </div>
  </header>

  <section class="tab" data-tab="overview" id="ov">
    <p class="status" id="ov-status">loading…</p>
    <div class="grid">
      <fieldset class="span-8">
        <legend><b id="hero-k">day</b> <span id="hero-when"></span></legend>
        <div class="tape-head" id="hero-head"></div>
        <div id="cols-wrap" hidden>
          <div class="cols" id="cols" role="img" aria-label="Active time per day in the range"></div>
          <div class="cols-axis" id="cols-axis" aria-hidden="true"></div>
        </div>
        <div class="tod-k" id="tod-k" hidden>time of day <span>· where an average active day's time lands</span></div>
        <div class="tape-wrap" id="tape-wrap">
          <div class="tape" id="tape" role="img" aria-label="Active time across the day"></div>
          <div class="ticks" id="ticks" aria-hidden="true"></div>
        </div>
        <div class="target" id="target"></div>
        <div class="legend" id="tape-legend"></div>
      </fieldset>

      <fieldset class="span-4 streak">
        <legend><b>streak</b></legend>
        <div class="big" id="streak-big"><span id="streak-n">0</span><small>days</small></div>
        <div class="days" id="days"></div>
        <p id="streak-long"></p>
        <p id="streak-range" hidden></p>
      </fieldset>

      <fieldset class="span-7">
        <legend><b>lines</b> <span id="lines-when"></span></legend>
        <div class="diff">
          <span class="big add" id="ln-add">+0</span>
          <span class="big del" id="ln-del">−0</span>
          <span class="kv">net <b id="ln-net">+0</b></span>
        </div>
        <div class="week" id="week" aria-label="Lines added and removed"></div>
      </fieldset>

      <fieldset class="span-5">
        <legend><b>languages</b> <span id="lang-when"></span></legend>
        <div class="lang" id="lang"></div>
      </fieldset>

      <fieldset class="span-7">
        <legend><b>files</b> <span id="files-when">git diff --stat</span></legend>
        <table class="stat" id="stat"></table>
      </fieldset>

      <fieldset class="span-5">
        <legend><b id="log-k">sessions</b> <span id="log-when"></span></legend>
        <ul class="log" id="log"></ul>
      </fieldset>
    </div>
  </section>

  <section class="tab" data-tab="activity" hidden>
    <div class="filters">
      <span>project</span>
      <div class="opts" role="group" aria-label="Project filter" id="act-filter"></div>
    </div>
    <div class="grid">
      <fieldset class="span-12">
        <legend><b>year</b> past 12 months<span id="ystats-who"></span></legend>
        <div class="ystats" id="ystats"></div>
      </fieldset>
      <fieldset class="span-12">
        <legend><b>activity</b> <span id="heat-range">daily active time, past 12 months</span></legend>
        <div class="heat-wrap" id="heat-wrap">
          <div class="heat-inner">
            <span></span>
            <div class="months" id="months"></div>
            <div class="wd" aria-hidden="true"><span>mon</span><span></span><span>wed</span><span></span><span>fri</span><span></span><span>sun</span></div>
            <div class="heat" id="heat" role="img" aria-label="Active time per day for the past year, one cell per day"></div>
          </div>
        </div>
        <div class="legend heat-key">
          <span><b class="z">·</b> none</span><span><b>░</b> under 30m</span><span><b>▒</b> under 1h30</span><span><b>▓</b> under 3h</span><span><b>█</b> 3h or more</span><span><b class="now">█</b> today</span>
        </div>
      </fieldset>
      <fieldset class="span-12" id="prows-box">
        <legend><b>projects</b> share of active time, past 12 months</legend>
        <div class="split" id="split" aria-hidden="true"></div>
        <div class="prows" id="prows"></div>
      </fieldset>
    </div>
  </section>

  <section class="tab" data-tab="projects" hidden>
    <div class="filters">
      <span>sort</span>
      <div class="opts" role="group" aria-label="Sort projects by" id="sort">
        <button data-v="time" aria-pressed="true">active today</button><button data-v="last" aria-pressed="false">last active</button><button data-v="name" aria-pressed="false">name</button>
      </div>
    </div>
    <div class="grid" id="pcards"></div>
  </section>

  <section class="tab" data-tab="settings" hidden>
    <div class="grid">
      <fieldset class="span-12" id="set-tracking">
        <legend><b>tracking</b></legend>
        <div class="set">
          <div><label class="name" for="pref-target">daily target</label><div class="desc">Streak target across all projects. Projects can override it on the projects tab.</div></div>
          <div class="ctl">
            <button class="btn step" data-for="pref-target" data-step="-5" aria-label="Decrease daily target">−</button>
            <input class="tin" id="pref-target" type="number" min="1" max="1440" step="5" data-saved="">
            <button class="btn step" data-for="pref-target" data-step="5" aria-label="Increase daily target">+</button>
            <span class="unit">min</span>
            <button class="btn" data-apply="pref-target" data-label="daily target" disabled>apply</button>
          </div>
        </div>
        <div class="set">
          <div><label class="name" for="pref-idle">pause after</label><div class="desc">Minutes with no activity before the active timer pauses. Logged time is kept.</div></div>
          <div class="ctl">
            <button class="btn step" data-for="pref-idle" data-step="-1" aria-label="Decrease pause threshold">−</button>
            <input class="tin" id="pref-idle" type="number" min="1" max="60" step="1" data-saved="">
            <button class="btn step" data-for="pref-idle" data-step="1" aria-label="Increase pause threshold">+</button>
            <span class="unit">min</span>
            <button class="btn" data-apply="pref-idle" data-label="pause after" disabled>apply</button>
          </div>
        </div>
      </fieldset>

      <fieldset class="span-12">
        <legend><b>display</b> crt</legend>
        <div class="osd" id="osd">
          <span class="k">mask</span>
          <div class="opts" role="group" aria-label="Phosphor mask" data-key="mask">
            <button data-v="slot">slot mask</button><button data-v="grille">aperture grille</button><button data-v="shadow">shadow mask</button><button data-v="off">off</button>
          </div>
          <span class="k">pitch</span>
          <div class="opts" role="group" aria-label="Mask pitch" data-key="pitch">
            <button data-v="fine">fine</button><button data-v="medium">medium</button><button data-v="coarse">coarse</button>
          </div>
          <span class="k"><label for="strength">strength</label></span>
          <div class="opts"><input id="strength" type="range" min="0" max="100" step="1"><output id="strength-out" for="strength"></output></div>
          <span class="k">effects</span>
          <div class="opts" role="group" aria-label="Effects" data-key="effects">
            <button data-v="scanlines">scanlines</button><button data-v="bloom">bloom</button><button data-v="convergence">convergence</button><button data-v="roll">refresh roll</button><button data-v="flicker">flicker</button>
          </div>
          <p class="why">Slot mask: staggered RGB slots, as on most consumer TVs and terminals. Aperture grille: unbroken vertical stripes (Trinitron). Shadow mask: round dot triads. Light themes get half the strength; high contrast turns the CRT off. Refresh roll and flicker stop when your system asks for reduced motion.</p>
        </div>
      </fieldset>

      <fieldset class="span-12">
        <legend><b>your data</b> stored on this machine only</legend>
        <div class="set">
          <div><span class="name">storage location</span><div class="desc">Everything Rabbit Hole records lives here. Nothing is sent anywhere.</div><div class="spath" id="spath"></div></div>
          <div class="ctl"><button class="btn" data-act="reveal">reveal</button></div>
        </div>
        <div class="set">
          <div><span class="name">export</span><div class="desc">Save a share card or a report, or the raw data as CSV or JSON.</div></div>
          <div class="ctl"><button class="btn" data-act="export">export…</button></div>
        </div>
        <div class="set">
          <div><span class="name">back up everything</span><div class="desc">Writes a complete, restorable copy of all your data to the backups folder.</div></div>
          <div class="ctl"><button class="btn" data-act="backup-all">create backup</button></div>
        </div>
        <div class="set">
          <div><span class="name">back up some projects</span><div class="desc">A backup with only the projects you pick. Useful for moving one project to another machine.</div></div>
          <div class="ctl"><button class="btn" data-act="backup-some">choose projects…</button></div>
        </div>
        <div class="set">
          <div><span class="name">restore some projects</span><div class="desc">Pick projects out of a backup to undo a clear or bring one over. Projects you don't pick are left untouched.</div></div>
          <div class="ctl"><button class="btn" data-act="restore-some">choose projects…</button></div>
        </div>
        <div class="set">
          <div><span class="name">restore everything</span><div class="desc">Replaces this machine's history with every project in a backup. Projects not in the backup are kept. A backup is written first.</div></div>
          <div class="ctl"><button class="btn" data-act="restore-all">restore all…</button></div>
        </div>
      </fieldset>

      <fieldset class="span-12 danger">
        <legend><b>danger</b> a backup is written before either of these runs</legend>
        <div class="set">
          <div><label class="name" for="clear-proj">clear a project's history</label><div class="desc">Deletes every logged day for one project. Type its exact name to confirm.</div></div>
          <div class="ctl">
            <select class="tin" id="clear-proj"></select>
            <input class="tin wide" id="clear-proj-confirm" type="text" placeholder="project name" spellcheck="false" autocomplete="off" aria-label="Type the project name to confirm">
            <button class="btn danger" id="clear-proj-btn" disabled>clear</button>
          </div>
        </div>
        <div class="set">
          <div><label class="name" for="clear-all-confirm">clear everything</label><div class="desc">Deletes all projects and all logged history. Type DELETE to confirm.</div></div>
          <div class="ctl">
            <input class="tin wide" id="clear-all-confirm" type="text" placeholder="DELETE" spellcheck="false" autocomplete="off">
            <button class="btn danger" id="clear-all-btn" disabled>delete all</button>
          </div>
        </div>
      </fieldset>

      <fieldset class="span-12">
        <legend><b>output</b></legend>
        <div class="console" id="console" aria-live="polite"></div>
      </fieldset>
    </div>
  </section>
</div>

<div class="xd-back" id="xd" hidden>
  <div class="xd" role="dialog" aria-modal="true" aria-labelledby="xd-title">
    <fieldset>
      <legend><b id="xd-title">export</b></legend>
      <div class="osd">
        <span class="k">format</span>
        <div class="opts" id="xd-format" role="group" aria-label="Format"><button data-v="card">share card</button><button data-v="report">report</button><button data-v="csv">csv</button><button data-v="json">json</button></div>
        <span class="k">range</span>
        <div class="opts" id="xd-range" role="group" aria-label="Range"></div>
        <span class="k"><label for="xd-project">project</label></span>
        <div class="opts"><select class="tin" id="xd-project"></select></div>
        <p class="why" id="xd-what"></p>
      </div>
      <div class="xd-foot"><button class="btn" id="xd-cancel">cancel</button><button class="btn" id="xd-go">export</button></div>
    </fieldset>
  </div>
</div>

<div id="tip" hidden></div>
<canvas class="crt" id="mask" aria-hidden="true"></canvas>
<div class="crt crt-scan" aria-hidden="true"></div>
<div class="crt crt-roll" aria-hidden="true"></div>
<div class="crt crt-glass" aria-hidden="true"></div>
<script src="${scriptUri}"></script>
</body>
</html>`
  }
}
