const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..")
const cssSrc = path.join(root, "src", "webview", "style.css")
const cssOut = path.join(root, "out", "webview", "style.css")

function copyCss() {
  fs.mkdirSync(path.dirname(cssOut), { recursive: true })
  fs.copyFileSync(cssSrc, cssOut)
}

copyCss()
fs.watch(cssSrc, () => {
  try { copyCss(); console.log("[css] style.css updated") }
  catch (e) { console.error("[css] copy failed:", e.message) }
})

const logPlugin = {
  name: "watch-log",
  setup(build) {
    build.onStart(() => { process.stdout.write("[watch] build started\n") })
    build.onEnd(({ errors }) => {
      for (const { text, location: l } of errors) {
        console.error(l ? `${l.file}:${l.line}:${l.column}: error: ${text}` : `error: ${text}`)
      }
      process.stdout.write(errors.length ? "[watch] build failed\n" : "[watch] build finished\n")
    })
  },
}

let ctxs = []

async function main() {
  ctxs = await Promise.all([
    esbuild.context({
      entryPoints: ["src/extension.ts"],
      bundle: true,
      outfile: "out/extension.js",
      external: ["vscode"],
      platform: "node",
      sourcemap: true,
      logLevel: "silent",
      plugins: [logPlugin],
    }),
    esbuild.context({
      entryPoints: ["src/webview/main.ts"],
      bundle: true,
      outfile: "out/webview/main.js",
      platform: "browser",
      sourcemap: true,
      logLevel: "silent",
      plugins: [logPlugin],
    }),
  ])

  await Promise.all(ctxs.map(c => c.watch()))
  console.log("[watch] watching for changes — Ctrl+C to stop")
}

main().catch(e => { console.error(e); process.exit(1) })

process.on("SIGINT", () => {
  Promise.all(ctxs.map(c => c.dispose())).then(() => process.exit(0))
})
