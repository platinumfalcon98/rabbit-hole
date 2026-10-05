import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/webview/stepper.ts
import { stepValue, validFor } from "stepper"

describe("target inputs", () => {
  it("accept whole minutes within the bounds", () => {
    assert.strictEqual(validFor("20", 1, 1440, false), true)
    assert.strictEqual(validFor(" 1440 ", 1, 1440, false), true)
    for (const bad of ["0", "1441", "12.5", "-5", "abc", "1e3"]) assert.strictEqual(validFor(bad, 1, 1440, false), false, bad)
  })

  it("empty is valid only where it means 'use the global target'", () => {
    assert.strictEqual(validFor("", 1, 1440, true), true)
    assert.strictEqual(validFor("  ", 1, 1440, false), false)
  })

  it("steppers start from the placeholder and stay in bounds", () => {
    assert.strictEqual(stepValue("", "20", 5, 1, 1440), "25")
    assert.strictEqual(stepValue("1438", "", 5, 1, 1440), "1440")
    assert.strictEqual(stepValue("3", "", -5, 1, 1440), "1")
    assert.strictEqual(stepValue("", "", 5, 1, 1440), "5")
  })
})
