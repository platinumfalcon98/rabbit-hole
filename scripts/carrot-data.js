const path = require("node:path")
const vm = require("node:vm")
const { buildSync } = require("esbuild")

function loadCarrot() {
  const result = buildSync({
    entryPoints: [path.join(__dirname, "../src/webview/carrot.ts")],
    bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent",
  })
  const module = { exports: {} }
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports })
  const { CARROT, CARROT_W, CARROT_H, CARROT_COLORS } = module.exports
  return JSON.parse(JSON.stringify({
    rows: CARROT, width: CARROT_W, height: CARROT_H, colors: CARROT_COLORS,
  }))
}
module.exports = { loadCarrot }
if (require.main === module) process.stdout.write(JSON.stringify(loadCarrot()))
