const fs = require("node:fs")
const path = require("node:path")
const { deflateSync } = require("node:zlib")
const { loadCarrot } = require("./carrot-data")

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const name = Buffer.from(type, "ascii")
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  name.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8)
  return out
}
const { rows, colors } = loadCarrot()
const raw = Buffer.alloc(128 * 385)
for (let y = 0; y < 128; y++) {
  for (let x = 0; x < 128; x++) {
    const gx = Math.floor((x - 8) / 8), gy = Math.floor((y - 24) / 8)
    const cell = gx >= 0 && gx < 14 && gy >= 0 && gy < 10 ? rows[gy][gx] : "."
    Buffer.from((cell === "." ? "#06090a" : colors[cell]).slice(1), "hex")
      .copy(raw, y * 385 + 1 + x * 3)
  }
}
const header = Buffer.alloc(13)
header.writeUInt32BE(128, 0)
header.writeUInt32BE(128, 4)
header[8] = 8
header[9] = 2
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
])
const out = process.argv[2] || path.join(__dirname, "../resources/icon.png")
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, png)
