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

// Both contexts below share this plugin, so logging per build emitted two
// "started"/"finished" pairs per round. VS Code's background problemMatcher is
// a toggle -- beginsPattern makes the task active, endsPattern makes it idle --
// and the two contexts finish in no fixed order. An interleaving that ends on
// the second "started" leaves the task active forever: the preLaunchTask never
// completes and F5 never launches the host, while the compiler goes on working
// perfectly and hides the cause. Counting in-flight builds collapses a round
// into exactly one pair, however many contexts take part.
let inFlight = 0
let roundFailed = false

const logPlugin = {
  name: "watch-log",
  setup(build) {
    build.onStart(() => {
      if (inFlight++ === 0) {
        roundFailed = false
        process.stdout.write("[watch] build started\n")
      }
    })
    build.onEnd(({ errors }) => {
      for (const { text, location: l } of errors) {
        console.error(l ? `${l.file}:${l.line}:${l.column}: error: ${text}` : `error: ${text}`)
      }
      if (errors.length) { roundFailed = true }
      if (--inFlight === 0) {
        // A failed round still has to end. The matcher only releases the task on
        // endsPattern, so signalling failure by withholding it would hang F5
        // rather than surface the errors printed above -- and those reach the
        // Problems panel through the matcher's own pattern either way.
        process.stdout.write(`[watch] build finished${roundFailed ? " with errors" : ""}\n`)
      }
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
      entryPoints: ["src/webview/main.ts", "src/webview/miniTheme.ts"],
      bundle: true,
      outdir: "out/webview",
      platform: "browser",
      loader: { ".ttf": "base64" },
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
