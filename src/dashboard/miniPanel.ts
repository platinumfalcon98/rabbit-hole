import * as vscode from "vscode"
import type { ExtensionMessage, MiniMessage } from "../shared/types"

// The Activity Bar sidebar: static markup around the mini bundle
// (src/webview/mini.ts), which draws everything from the host's `mini`
// message. The panels are fixed here; mini.ts fills them.
export class MiniPanel implements vscode.WebviewViewProvider {
  static readonly viewId = "rabbithole.miniView"
  private view?: vscode.WebviewView

  constructor(private readonly extensionUri: vscode.Uri, private readonly onMessage: (msg: MiniMessage) => void) {}

  // Nothing is built or sent while the sidebar is collapsed or covered.
  get visible(): boolean {
    return !!this.view?.visible
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")] }
    view.webview.html = this.html(view.webview)
    view.webview.onDidReceiveMessage(m => this.onMessage(m as MiniMessage))
    // shown again: the last tick it saw may be long gone
    view.onDidChangeVisibility(() => { if (view.visible) this.onMessage({ type: "ready" }) })
  }

  postMessage(message: ExtensionMessage): void {
    void this.view?.webview.postMessage(message)
  }

  private html(webview: vscode.Webview): string {
    const asset = (...path: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webview", ...path))
    const csp = webview.cspSource
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${csp}; style-src ${csp} 'unsafe-inline'; font-src ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @font-face { font-family: "Martian Mono"; src: url("${asset("fonts", "MartianMono-VF.woff2")}") format("woff2"); font-weight: 100 800; font-stretch: 75% 112.5%; font-display: block; }
  </style>
  <link rel="stylesheet" href="${asset("style.css")}">
  <link rel="stylesheet" href="${asset("mini.css")}">
  <title>Rabbit Hole</title>
</head>
<body>
<div class="screen mini" id="mini">
  <div class="brand"><span id="brand"></span><div><div class="word">rabbit hole</div><div class="proj" id="here"></div></div></div>

  <fieldset class="streak">
    <legend><b>streak</b></legend>
    <div class="row"><span class="big" id="st-n">0</span><span class="k">days</span></div>
    <div class="days" id="st-days" aria-label="The last 14 days against the target"></div>
  </fieldset>

  <fieldset>
    <legend><b>today</b> <span id="td-who">all projects</span></legend>
    <div class="row"><span class="big" id="td-t">0m</span><span class="k" id="td-k"></span></div>
    <div class="meter" id="td-meter"></div>
    <div class="tape-wrap" id="tape-wrap">
      <div class="tape" id="tape" role="img" aria-label="Active time across the day"></div>
      <div class="ticks" id="ticks" aria-hidden="true"></div>
    </div>
  </fieldset>

  <fieldset>
    <legend><b>lines</b> <span id="ln-who">today · all projects</span></legend>
    <div class="row"><span class="mid add" id="ln-a">+0</span><span class="mid del" id="ln-d">−0</span></div>
  </fieldset>

  <fieldset>
    <legend><b>7 days</b> <span id="wk-who">all projects</span></legend>
    <div class="cols" id="wk-cols" role="img" aria-label="Active time for the last seven days"></div>
    <div class="dlabels" id="wk-labels" aria-hidden="true"></div>
    <div class="pkeys" id="wk-keys"></div>
  </fieldset>

  <fieldset>
    <legend><b>projects</b> today</legend>
    <div class="split" id="pj-split" aria-hidden="true"></div>
    <div class="plist" id="pj-list"></div>
  </fieldset>

  <button class="open" id="open" type="button">open dashboard</button>
</div>
<div id="tip" hidden></div>
<canvas class="crt" id="mask" aria-hidden="true"></canvas>
<div class="crt crt-scan" aria-hidden="true"></div>
<div class="crt crt-roll" aria-hidden="true"></div>
<div class="crt crt-glass" aria-hidden="true"></div>
<script src="${asset("mini.js")}"></script>
</body>
</html>`
  }
}
