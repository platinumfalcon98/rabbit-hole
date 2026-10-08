// Builds the real dashboard and sidebar into public/ui/ for the film:
//   main.js / mini.js  — src/webview/main.ts and mini.ts, built as `npm run build:webview` does
//   style.css, mini.css, fonts/ — copied unchanged
//   host.html / mini.html — the markup DashboardPanel / MiniPanel generate, CSP removed,
//                            dark theme, with host.js / miniHost.js loaded first
//   host.js / miniHost.js — ui-host/: the stub VS Code API serving the showcase data,
//                            a frozen clock and the per-frame view driver
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ad = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const root = path.resolve(ad, "..")
const require = createRequire(path.join(root, "package.json"))
const esbuild = require("esbuild")
const out = path.join(ad, "public", "ui")
const tmp = path.join(ad, "out", "ui-build")
fs.mkdirSync(path.join(out, "fonts"), { recursive: true })
fs.mkdirSync(tmp, { recursive: true })

// 1. the real webview bundles
esbuild.buildSync({
  entryPoints: [path.join(root, "src/webview/main.ts"), path.join(root, "src/webview/mini.ts")],
  bundle: true, outdir: out, platform: "browser", loader: { ".ttf": "base64" }, logLevel: "warning",
})
for (const f of ["style.css", "mini.css"]) fs.copyFileSync(path.join(root, "src/webview", f), path.join(out, f))
fs.copyFileSync(path.join(root, "src/webview/fonts/MartianMono-VF.woff2"), path.join(out, "fonts/MartianMono-VF.woff2"))
fs.copyFileSync(path.join(root, "resources/rabbithole-icons.woff"), path.join(out, "fonts/rabbithole-icons.woff"))
fs.copyFileSync(path.join(root, "resources/rabbithole-icon.svg"), path.join(out, "rabbithole-icon.svg"))
fs.copyFileSync(path.join(root, "resources/icon.svg"), path.join(out, "activitybar-icon.svg"))

// 2. the markup, extracted from the real panels with a stub vscode module
const vscodeStub = path.join(tmp, "vscode-stub.js")
fs.writeFileSync(vscodeStub, `
let html = ""
const webview = { cspSource: "", asWebviewUri: u => u.rel.replace("out/webview/", ""), set html(v) { html = v }, get html() { return html }, postMessage() {}, onDidReceiveMessage() {} }
module.exports = {
  html: () => html,
  ViewColumn: { One: 1 },
  Uri: { joinPath: (_base, ...parts) => ({ rel: parts.join("/") }) },
  window: {
    activeTextEditor: undefined,
    createWebviewPanel: () => ({ webview, onDidDispose() {}, reveal() {}, dispose() {} }),
  },
  webview,
}`)
esbuild.buildSync({
  stdin: {
    contents: `
      const v = require("vscode")
      const { DashboardPanel } = require("./src/dashboard/dashboardPanel")
      const { MiniPanel } = require("./src/dashboard/miniPanel")
      DashboardPanel.createOrShow({ extensionUri: {} })
      const dash = v.html()
      new MiniPanel({}, () => {}).resolveWebviewView({ webview: v.webview, onDidChangeVisibility() {}, visible: true })
      module.exports = { dash, mini: v.html() }`,
    resolveDir: root, loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", outfile: path.join(tmp, "panels.cjs"), alias: { vscode: vscodeStub }, logLevel: "warning",
})
const { dash, mini } = require(path.join(tmp, "panels.cjs"))

// Film-only CSS: no transitions or CSS animations (every frame is set by the
// driver), and the UI's own CRT layers off: the whole-frame CRT pass draws them.
const FILM_CSS = `<style id="film">
  *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent; }
  .crt { display: none !important; }
  html, body { overflow: hidden; }
</style>`
function page(html, hostScript, label) {
  const out = html
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
    .replace("<body>", `<body class="vscode-dark">`)
    .replace("</head>", `${FILM_CSS}\n<style id="shot"></style>\n</head>`)
    .replace(/<script src="/, `<script src="${hostScript}"></script>\n<script src="`)
  if (out === html || !out.includes(hostScript)) throw new Error(`could not patch the ${label} markup`)
  return out
}
fs.writeFileSync(path.join(out, "host.html"), page(dash, "host.js", "dashboard"))
fs.writeFileSync(path.join(out, "mini.html"), page(mini, "miniHost.js", "sidebar"))

// 3. the hosts
esbuild.buildSync({
  entryPoints: { host: path.join(ad, "ui-host/host.ts"), miniHost: path.join(ad, "ui-host/miniHost.ts") },
  bundle: true, outdir: out, platform: "browser", format: "iife", logLevel: "warning",
})
console.log("built", path.relative(ad, out))
