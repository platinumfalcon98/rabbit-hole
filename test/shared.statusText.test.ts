import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/shared/statusText.ts
import { statusText } from "statusText"

const MIN = 60_000

describe("status bar text", () => {
  it("shows today's active time against the target, behind the carrot", () => {
    assert.strictEqual(statusText(220 * MIN + 59_000, 20 * MIN), "$(rabbithole-carrot) 3h40m / 20m")
  })

  it("never rounds up to time not yet reached", () => {
    assert.strictEqual(statusText(59_999, 20 * MIN), "$(rabbithole-carrot) 0m / 20m")
    assert.strictEqual(statusText(61 * MIN, 90 * MIN), "$(rabbithole-carrot) 1h01m / 1h30m")
  })
})
