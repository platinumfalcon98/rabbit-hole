// Usage: node scripts/verify-lines.js [YYYY-MM-DD] --repo <path> [--repo <path>…] [--mirror <dir>]
// Bundles scripts/verify-lines/main.ts (it reuses the tracker's own git and
// path rules) and runs it. Exit code 0 = no mismatches.
const path = require("path")
const { spawnSync } = require("child_process")
const esbuild = require("esbuild")
const root = path.join(__dirname, "..")
const out = path.join(root, "test", ".out", "verify-lines.js")
esbuild.buildSync({ entryPoints: [path.join(__dirname, "verify-lines", "main.ts")], outfile: out, bundle: true, platform: "node", format: "cjs", logLevel: "warning" })
const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(r.status ?? 1)
