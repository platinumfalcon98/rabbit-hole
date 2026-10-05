// Writes test/.out/harness/dashboard.html: the real dashboard markup without
// its CSP, loading the built webview and a stub VS Code API serving fixture
// data. Run `npm run build` first, then `node test/harness/dashboard.js`, serve
// the repo root (python -m http.server 8123) and open
// http://localhost:8123/test/.out/harness/dashboard.html
const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const out = path.join(root, "test", ".out", "harness")
fs.mkdirSync(out, { recursive: true })

const vscodeStub = path.join(out, "vscode-panel-stub.js")
fs.writeFileSync(vscodeStub, `
let html = ""
module.exports = {
  html: () => html,
  ViewColumn: { One: 1 },
  Uri: { joinPath: (_base, ...parts) => ({ rel: parts.join("/") }) },
  window: {
    activeTextEditor: undefined,
    createWebviewPanel: () => ({
      webview: { cspSource: "", asWebviewUri: u => "/" + u.rel, set html(v) { html = v }, postMessage() {}, onDidReceiveMessage() {} },
      onDidDispose() {}, reveal() {}, dispose() {},
    }),
  },
}`)

esbuild.buildSync({
  stdin: {
    contents: `const v = require("vscode"); const { DashboardPanel } = require("./src/dashboard/dashboardPanel"); DashboardPanel.createOrShow({ extensionUri: {} }); module.exports = v.html()`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", outfile: path.join(out, "panel.js"), alias: { vscode: vscodeStub }, logLevel: "warning",
})
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "dashboardStub.ts")],
  bundle: true, platform: "browser", outfile: path.join(out, "stub.js"), logLevel: "warning",
})

const html = require(path.join(out, "panel.js"))
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
  .replace("<script src=", `<script src="stub.js"></script>\n<script src=`)
fs.writeFileSync(path.join(out, "dashboard.html"), html)
console.log("wrote", path.join(out, "dashboard.html"))
