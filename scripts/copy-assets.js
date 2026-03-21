const fs = require("fs")
const path = require("path")

const src = path.join(__dirname, "..", "src", "webview", "style.css")
const destDir = path.join(__dirname, "..", "out", "webview")
const dest = path.join(destDir, "style.css")

fs.mkdirSync(destDir, { recursive: true })
fs.copyFileSync(src, dest)
console.log("Copied style.css →", dest)
