// Test runner. Each suite is bundled by esbuild with `vscode` aliased to a stub
// and the modules under test aliased to their real source files, then run with
// node's built-in test runner.
//
// Bundling (rather than runtime module mocking) is what lets these tests
// exercise the real, unmodified source: only the platform beneath it is
// replaced. It is also what makes the negative-control workflow possible — see
// --alias below.
//
//   node scripts/test.js                       # everything
//   node scripts/test.js --suite import        # one suite (substring match)
//   node scripts/test.js --suite import --alias storage=src/tracker/_negcontrol.ts
//
// That last form is the negative control: point a suite at a deliberately
// broken copy of a source file and confirm the relevant tests FAIL. A fix is
// not verified until the test fails without it.
//
// The temp copy must live inside src/ — relative imports like "../shared/config"
// do not resolve from outside the source tree.

const path = require("path")
const fs = require("fs")
const { spawnSync } = require("child_process")
const esbuild = require("esbuild")

const root = path.join(__dirname, "..")
const outDir = path.join(root, "test", ".out")

const src = p => path.join(root, p)

const SUITES = [
  { name: "icons", entry: "test/icons.assets.test.ts", alias: { carrot: "src/webview/carrot.ts" } },
  {
    name: "datekey",
    entry: "test/storage.datekey.test.ts",
    alias: { vscode: "test/stubs/vscode.ts", storage: "src/tracker/storageService.ts" },
  },
  {
    name: "settings",
    entry: "test/storage.settings.test.ts",
    alias: {
      vscode: "test/stubs/vscode.ts",
      storage: "src/tracker/storageService.ts",
      cfg: "src/shared/config.ts",
    },
  },
  {
    name: "crt",
    entry: "test/config.crt.test.ts",
    alias: { vscode: "test/stubs/vscode.ts", cfg: "src/shared/config.ts" },
  },
  {
    name: "payloads",
    entry: "test/dashboard.payloads.test.ts",
    alias: {
      vscode: "test/stubs/vscode.ts",
      storage: "src/tracker/storageService.ts",
      payloads: "src/dashboard/payloads.ts",
    },
  },
  {
    name: "export",
    entry: "test/storage.export.test.ts",
    alias: { vscode: "test/stubs/vscode.ts", storage: "src/tracker/storageService.ts" },
  },
  {
    name: "model",
    entry: "test/webview.model.test.ts",
    alias: { model: "src/webview/model.ts" },
  },
  {
    name: "model2",
    entry: "test/webview.model2.test.ts",
    alias: { model: "src/webview/model.ts" },
  },
  {
    name: "dst",
    entry: "test/webview.dst.test.ts",
    alias: { model: "src/webview/model.ts" },
    env: { TZ: "America/New_York" },
  },
  {
    name: "view",
    entry: "test/webview.view.test.ts",
    alias: {
      format: "src/webview/format.ts",
      layout: "src/webview/layout.ts",
      colors: "src/webview/colors.ts",
      calendar: "src/webview/calendar.ts",
    },
  },
  {
    name: "carrot",
    entry: "test/webview.carrot.test.ts",
    alias: { carrot: "src/webview/carrot.ts" },
  },
  {
    name: "state",
    entry: "test/webview.state.test.ts",
    alias: { state: "src/webview/state.ts" },
  },
  {
    name: "display",
    entry: "test/webview.display.test.ts",
    alias: { crt: "src/webview/crt.ts", focus: "src/webview/focus.ts" },
  },
  {
    name: "stepper",
    entry: "test/webview.stepper.test.ts",
    alias: { stepper: "src/webview/stepper.ts" },
  },
  {
    name: "handler",
    entry: "test/dashboard.handler.test.ts",
    alias: {
      vscode: "test/stubs/vscodeHost.ts",
      storage: "src/tracker/storageService.ts",
      handler: "src/dashboard/messageHandler.ts",
    },
  },
  {
    name: "clear",
    entry: "test/storage.clear.test.ts",
    alias: { vscode: "test/stubs/vscode.ts", storage: "src/tracker/storageService.ts" },
  },
  {
    name: "import",
    entry: "test/storage.import.test.ts",
    alias: { vscode: "test/stubs/vscode.ts", storage: "src/tracker/storageService.ts" },
  },
  {
    name: "capture",
    entry: "test/tracker.capture.test.ts",
    alias: { vscode: "test/stubs/vscodeWindow.ts", tracker: "src/tracker/activityTracker.ts" },
  },
  {
    name: "languages",
    entry: "test/tracker.languages.test.ts",
    alias: { vscode: "test/stubs/vscodeWindow.ts", tracker: "src/tracker/activityTracker.ts" },
  },
  {
    name: "persist",
    entry: "test/tracker.persist.test.ts",
    alias: {
      vscode: "test/stubs/vscodeWindow.ts",
      tracker: "src/tracker/activityTracker.ts",
      ledgerStore: "src/tracker/ledgerStore.ts",
      storage: "src/tracker/storageService.ts",
    },
  },
  {
    name: "ledger",
    entry: "test/tracker.ledger.test.ts",
    alias: { vscode: "test/stubs/vscode.ts", ledger: "src/tracker/lineLedger.ts" },
  },
  {
    name: "paths",
    entry: "test/tracker.paths.test.ts",
    alias: { vscode: "test/stubs/vscode.ts", paths: "src/tracker/pathRules.ts" },
  },
  {
    name: "files",
    entry: "test/storage.files.test.ts",
    alias: { vscode: "test/stubs/vscode.ts", storage: "src/tracker/storageService.ts" },
  },
  {
    name: "fonts",
    entry: "test/webview.fonts.test.ts",
    alias: { textFit: "src/webview/textFit.ts" },
  },
  {
    name: "exportname",
    entry: "test/shared.exportName.test.ts",
    alias: { exportName: "src/shared/exportName.ts" },
  },
  {
    name: "exportdata",
    entry: "test/webview.exportData.test.ts",
    alias: { exportModel: "src/webview/exportModel.ts" },
  },
  {
    name: "exportlayout",
    entry: "test/webview.exportLayout.test.ts",
    alias: { exportModel: "src/webview/exportModel.ts", exportLayout: "src/webview/exportLayout.ts" },
  },
  {
    name: "report",
    entry: "test/webview.report.test.ts",
    alias: { exportModel: "src/webview/exportModel.ts", report: "src/webview/reportPdf.ts" },
  },
  {
    name: "status",
    entry: "test/shared.statusText.test.ts",
    alias: { statusText: "src/shared/statusText.ts" },
  },
  {
    name: "mini",
    entry: "test/webview.mini.test.ts",
    alias: { miniModel: "src/webview/miniModel.ts" },
  },
  {
    name: "minihandler",
    entry: "test/dashboard.mini.test.ts",
    alias: {
      vscode: "test/stubs/vscodeHost.ts",
      storage: "src/tracker/storageService.ts",
      miniHandler: "src/dashboard/miniHandler.ts",
    },
  },
]

function parseArgs(argv) {
  const opts = { suite: null, alias: {} }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--suite") opts.suite = argv[++i]
    else if (argv[i] === "--alias") {
      const [key, value] = argv[++i].split("=")
      opts.alias[key] = value
    }
  }
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const suites = opts.suite
    ? SUITES.filter(s => s.name.includes(opts.suite))
    : SUITES

  if (suites.length === 0) {
    console.error(`No suite matches "${opts.suite}". Known: ${SUITES.map(s => s.name).join(", ")}`)
    process.exit(1)
  }

  fs.mkdirSync(outDir, { recursive: true })

  const overridden = Object.keys(opts.alias)
  if (overridden.length > 0) {
    console.log(`alias override: ${overridden.map(k => `${k}=${opts.alias[k]}`).join(", ")}\n`)
  }

  const failed = []
  for (const suite of suites) {
    const alias = {}
    for (const [key, value] of Object.entries({ ...suite.alias, ...opts.alias })) {
      alias[key] = src(value)
    }

    const bundle = path.join(outDir, `${suite.name}.js`)
    esbuild.buildSync({
      entryPoints: [src(suite.entry)],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "cjs",
      sourcemap: "inline",
      alias,
      loader: { ".ttf": "base64" },
      logLevel: "warning",
    })

    const run = spawnSync(process.execPath, ["--test", "--test-reporter=spec", bundle], {
      stdio: "inherit",
      cwd: root,
      env: { ...process.env, ...suite.env },
    })
    if (run.status !== 0) failed.push(suite.name)
  }

  if (failed.length > 0) {
    console.error(`\nFAILED: ${failed.join(", ")}`)
    process.exit(1)
  }
  console.log(`\nAll ${suites.length} suite(s) passed.`)
}

main()
