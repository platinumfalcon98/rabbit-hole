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
      logLevel: "warning",
    })

    const run = spawnSync(process.execPath, ["--test", "--test-reporter=spec", bundle], {
      stdio: "inherit",
      cwd: root,
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
