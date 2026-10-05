const fs = require("fs")
const path = require("path")

const destDir = path.join(__dirname, "..", "out", "webview")
fs.mkdirSync(destDir, { recursive: true })

// CSS: the dashboard's styles, and the sidebar's, which load on top of them
for (const css of ["style.css", "mini.css"]) {
  const from = path.join(__dirname, "..", "src", "webview", css)
  fs.copyFileSync(from, path.join(destDir, css))
  console.log(`Copied ${css} →`, path.join(destDir, css))
}

// Fonts
const fontsSrc = path.join(__dirname, "..", "src", "webview", "fonts")
const fontsDest = path.join(destDir, "fonts")
fs.mkdirSync(fontsDest, { recursive: true })
for (const file of fs.readdirSync(fontsSrc)) {
  // the report's static fonts are bundled into main.js as base64 (--loader:.ttf=base64)
  if (/^MartianMono-.*\.ttf$/.test(file)) continue
  fs.copyFileSync(path.join(fontsSrc, file), path.join(fontsDest, file))
  console.log(`Copied fonts/${file} →`, path.join(fontsDest, file))
}
