// Writes test/.out/harness/sidebar.html: the real sidebar markup without its
// CSP, loading the built webview and a stub VS Code API serving fixture data.
// Run `npm run build` first, then `node test/harness/sidebar.js`, serve the
// repo root (python -m http.server 8123) and open
// http://localhost:8123/test/.out/harness/sidebar.html at sidebar widths
// (300 px, then 200 px for the narrow rules).
const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "..")
const out = path.join(root, "test", ".out", "harness")
fs.mkdirSync(out, { recursive: true })

const vscodeStub = path.join(out, "vscode-view-stub.js")
fs.writeFileSync(vscodeStub, `
let html = ""
module.exports = {
  html: () => html,
  Uri: { joinPath: (_base, ...parts) => ({ rel: parts.join("/") }) },
  view: () => ({
    visible: true,
    onDidChangeVisibility() {},
    webview: { options: {}, cspSource: "", asWebviewUri: u => "/" + u.rel, set html(v) { html = v }, onDidReceiveMessage() {}, postMessage() {} },
  }),
}`)

esbuild.buildSync({
  stdin: {
    contents: `const v = require("vscode"); const { MiniPanel } = require("./src/dashboard/miniPanel"); new MiniPanel({}, () => {}).resolveWebviewView(v.view()); module.exports = v.html()`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", outfile: path.join(out, "sidebar-panel.js"), alias: { vscode: vscodeStub }, logLevel: "warning",
})
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "sidebarStub.ts")],
  bundle: true, platform: "browser", outfile: path.join(out, "sidebar-stub.js"), logLevel: "warning",
})

const html = require(path.join(out, "sidebar-panel.js"))
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
  .replace("<script src=", `<script src="sidebar-stub.js"></script>\n<script src=`)
fs.writeFileSync(path.join(out, "sidebar.html"), html)
console.log("wrote", path.join(out, "sidebar.html"))
