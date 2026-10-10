import { describe, it } from "node:test"
import * as assert from "node:assert"
// @ts-ignore — esbuild alias to src/tracker/agentSpan.ts
import { AgentSpan, ENGAGE_GRACE_MS, changedLines } from "agentSpan"

const S = 1000
const MIN = 60_000
const total = (a: [string, number][]) => a.reduce((s, [, ms]) => s + ms, 0)

describe("take", () => {
  it("credits time inside the grace live and holds the rest", () => {
    const s = new AgentSpan()
    s.engage(0)
    assert.strictEqual(s.take("markdown", 0, 10 * MIN), ENGAGE_GRACE_MS)
    assert.deepStrictEqual(s.resolve(), [["markdown", 10 * MIN - ENGAGE_GRACE_MS]])
  })

  it("an interval wholly inside the grace holds nothing", () => {
    const s = new AgentSpan()
    s.engage(0)
    assert.strictEqual(s.take("go", 1 * S, 4 * S), 3 * S)
    assert.deepStrictEqual(s.resolve(), [])
  })

  it("an interval wholly past the grace is all held", () => {
    const s = new AgentSpan()
    s.engage(0)
    assert.strictEqual(s.take("go", MIN, 2 * MIN), 0)
    assert.deepStrictEqual(s.resolve(), [["go", MIN]])
  })

  it("an empty or reversed interval does nothing", () => {
    const s = new AgentSpan()
    s.engage(0)
    assert.strictEqual(s.take("go", MIN, MIN), 0)
    assert.strictEqual(s.take("go", 2 * MIN, MIN), 0)
    assert.deepStrictEqual(s.resolve(), [])
  })
})

describe("resolve", () => {
  it("with no edits gives each language back exactly what it was held under", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, 2 * MIN)
    s.take("json", 2 * MIN, 3 * MIN)
    const r = s.resolve()
    assert.deepStrictEqual(new Map(r), new Map([["markdown", 2 * MIN - ENGAGE_GRACE_MS], ["json", MIN]]))
  })

  it("shares the held total by edit events, not lines", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, 10 * MIN + ENGAGE_GRACE_MS) // holds exactly 10 min
    s.edit("go", 1, MIN)
    s.edit("go", 1, 2 * MIN)
    s.edit("json", 900, 3 * MIN)                     // a huge generated file is still one event
    const r = new Map(s.resolve())
    assert.strictEqual(r.get("go"), 400_000)
    assert.strictEqual(r.get("json"), 200_000)
    assert.strictEqual(r.has("markdown"), false)
  })

  it("rounding remainders go to the most-edited language, lines breaking ties", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, ENGAGE_GRACE_MS + 10) // holds 10 ms
    s.edit("go", 3, MIN)
    s.edit("rust", 7, MIN)
    s.edit("python", 1, MIN)
    const r = s.resolve()
    assert.strictEqual(total(r), 10)
    assert.deepStrictEqual(new Map(r), new Map([["rust", 4], ["go", 3], ["python", 3]]))
  })

  it("edits during the grace are not counted", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, 5 * MIN)
    s.edit("go", 10, ENGAGE_GRACE_MS - 1)
    assert.deepStrictEqual(s.resolve(), [["markdown", 5 * MIN - ENGAGE_GRACE_MS]])
  })

  it("clears held time and edits but keeps the span open", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, 2 * MIN)
    s.edit("go", 1, MIN)
    s.resolve()
    assert.deepStrictEqual(s.resolve(), [])
    assert.strictEqual(s.take("markdown", 2 * MIN, 3 * MIN), 0) // still past the grace
    assert.deepStrictEqual(s.resolve(), [["markdown", MIN]])    // the earlier go edit is gone
  })

  it("held time with only zero-ms languages resolves to nothing", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.edit("go", 1, MIN)
    assert.deepStrictEqual(s.resolve(), [])
  })
})

describe("engage / holding / reset", () => {
  it("engage clears counted edits", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.edit("go", 1, MIN)
    s.engage(2 * MIN)
    s.take("markdown", 2 * MIN, 2 * MIN + ENGAGE_GRACE_MS + MIN)
    assert.deepStrictEqual(s.resolve(), [["markdown", MIN]])
  })

  it("holding is true past the grace or while anything is held", () => {
    const s = new AgentSpan()
    s.engage(0)
    assert.strictEqual(s.holding(ENGAGE_GRACE_MS - 1), false)
    assert.strictEqual(s.holding(ENGAGE_GRACE_MS + 1), true)
    s.take("go", 0, MIN)
    assert.strictEqual(s.holding(MIN), true)
    s.engage(MIN)                            // closes the held span…
    assert.strictEqual(s.holding(MIN), false)
    assert.strictEqual(s.closedUntil(), MIN) // …which waits to be settled
  })

  it("reset drops everything", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("go", 0, 5 * MIN)
    s.reset()
    assert.deepStrictEqual(s.resolve(), [])
  })
})

describe("changedLines", () => {
  it("counts the multiset symmetric difference", () => {
    assert.strictEqual(changedLines([1, 2, 3], [1, 2, 3]), 0)
    assert.strictEqual(changedLines([1, 2, 3], [1, 4, 3]), 2)
    assert.strictEqual(changedLines([1, 1, 2], [1, 2]), 1)
    assert.strictEqual(changedLines([], [5, 6]), 2)
    assert.strictEqual(changedLines([3, 2, 1], [1, 2, 3]), 0) // reorder is not a change in a bag
  })
})

// An engagement or pause CLOSES a holding span rather than resolving it: the
// agent's last writes are measured 2 s+ later (the debounce, git status), and
// a late edit stamped inside the span must still weight it.
describe("closed spans", () => {
  it("engage closes a holding span; a late edit stamped inside it still counts", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, 5 * MIN)
    s.engage(5 * MIN)
    assert.strictEqual(s.closedUntil(), 5 * MIN)
    s.edit("go", 3, 5 * MIN) // seen at the moment of the click, measured later
    assert.deepStrictEqual(s.settle(), [["go", 5 * MIN - ENGAGE_GRACE_MS]])
    assert.strictEqual(s.closedUntil(), null)
  })

  it("a late edit stamped after the close does not reach the closed span", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, 5 * MIN)
    s.engage(5 * MIN)
    s.edit("go", 3, 5 * MIN + 1)
    assert.deepStrictEqual(s.settle(), [["markdown", 5 * MIN - ENGAGE_GRACE_MS]])
  })

  it("close with nothing held leaves nothing to settle", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, ENGAGE_GRACE_MS)
    s.close(ENGAGE_GRACE_MS)
    assert.strictEqual(s.closedUntil(), null)
    assert.deepStrictEqual(s.settle(), [])
  })

  it("resolve includes a closed span still waiting to settle", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, 2 * MIN)
    s.engage(2 * MIN)
    s.take("markdown", 2 * MIN, 3 * MIN) // grace, then held again
    assert.deepStrictEqual(s.resolve(), [["markdown", 3 * MIN - 2 * ENGAGE_GRACE_MS]])
    assert.strictEqual(s.closedUntil(), null)
  })

  it("two closes before a settle merge into one span", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, MIN)
    s.engage(MIN)
    s.take("markdown", MIN, 2 * MIN)
    s.close(2 * MIN)
    s.edit("go", 1, 30_000)
    s.edit("go", 1, 90_000)
    assert.strictEqual(s.closedUntil(), 2 * MIN)
    assert.deepStrictEqual(s.settle(), [["go", 2 * MIN - 2 * ENGAGE_GRACE_MS]])
  })
})

describe("midnight", () => {
  it("resolve(true) keeps the open span's edits for the time after the split", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, 10 * MIN)
    s.edit("go", 1, 5 * MIN)
    assert.deepStrictEqual(s.resolve(true), [["go", 10 * MIN - ENGAGE_GRACE_MS]])
    s.take("markdown", 10 * MIN, 20 * MIN)  // the same agent turn, after midnight
    assert.deepStrictEqual(s.resolve(), [["go", 10 * MIN]])
  })

  it("resolve(true) does not carry a closed span's edits", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("markdown", 0, 2 * MIN)
    s.engage(2 * MIN)
    s.edit("go", 1, MIN)                    // late edit into the closed span
    s.resolve(true)
    s.take("markdown", 2 * MIN, 4 * MIN)
    assert.deepStrictEqual(s.resolve(), [["markdown", 2 * MIN - ENGAGE_GRACE_MS]])
  })
})

// "" is time held with no usable editor; the tracker never credits it, so
// allocate may return it only when no edit claimed it.
describe("unattributed time", () => {
  it("\"\" comes back only when no edit claimed it", () => {
    const s = new AgentSpan()
    s.engage(0)
    s.take("", 0, 10 * MIN)
    assert.deepStrictEqual(s.resolve(), [["", 10 * MIN - ENGAGE_GRACE_MS]])
    s.engage(0)
    s.take("", 0, 10 * MIN)
    s.edit("go", 2, MIN)
    assert.deepStrictEqual(s.resolve(), [["go", 10 * MIN - ENGAGE_GRACE_MS]])
  })
})
