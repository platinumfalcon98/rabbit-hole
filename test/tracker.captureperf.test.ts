import { after, describe, it } from "node:test"
import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
// @ts-ignore — esbuild alias to src/tracker/dayCapture.ts
import { startDay } from "dayCapture"
// @ts-ignore — esbuild alias to src/tracker/captureStore.ts
import { captureFile } from "captureStore"

const D = fs.mkdtempSync(path.join(os.tmpdir(), "rabbithole-perf-"))
after(() => fs.rmSync(D, { recursive: true, force: true }))

describe("capture stays out of the extension host's way", () => {
  it("20,000 files: every one captured, no event-loop gap over 50 ms", { timeout: 300_000 }, async (t) => {
    for (let i = 0; i < 200; i++) {
      const sub = path.join(D, "w", `d${i}`)
      fs.mkdirSync(sub, { recursive: true })
      for (let j = 0; j < 100; j++) fs.writeFileSync(path.join(sub, `f${j}.ts`), `const a${j} = ${i}\nexport {}\n`)
    }
    let last = Date.now(), worst = 0
    const timer = setInterval(() => { const t = Date.now(); worst = Math.max(worst, t - last); last = t }, 10)
    const day = startDay([path.join(D, "w")], "d", Date.now() + 86_400_000, {
      git: null, jsonPath: captureFile(D, ["perf"]), yesterday: null, note: () => {},
    })
    const out = await day.done
    clearInterval(timer)
    assert.strictEqual(Object.keys(day.store.index()).length, 20_000)
    t.diagnostic(`longest event-loop gap ${worst} ms`)
    assert.ok(out.saved)
    assert.ok(worst <= 50, `longest gap ${worst} ms`)
  })
})
