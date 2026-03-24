const fs = require("fs")
const path = require("path")

const destDir = path.join(__dirname, "..", "out", "webview")
fs.mkdirSync(destDir, { recursive: true })

// CSS
const cssSrc = path.join(__dirname, "..", "src", "webview", "style.css")
fs.copyFileSync(cssSrc, path.join(destDir, "style.css"))
console.log("Copied style.css →", path.join(destDir, "style.css"))

// Fonts
const fontsSrc = path.join(__dirname, "..", "src", "webview", "fonts")
const fontsDest = path.join(destDir, "fonts")
fs.mkdirSync(fontsDest, { recursive: true })
for (const file of fs.readdirSync(fontsSrc)) {
  fs.copyFileSync(path.join(fontsSrc, file), path.join(fontsDest, file))
  console.log(`Copied fonts/${file} →`, path.join(fontsDest, file))
}
