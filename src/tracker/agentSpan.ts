// Language time while an agent works. VS Code keeps the last editor "active"
// while focus is in the terminal, so watching an agent rewrite Go with a
// README tab last focused would credit markdown. There is no "editor has
// keyboard focus" signal, so agent mode is inferred: no editor engagement
// (keyboard/mouse selection, scroll) for ENGAGE_GRACE_MS.
//
// Time past the grace is HELD under the language it would have gone to, and
// shared out when the span ends, by how many times each language's files
// changed on disk. Agents think for minutes and write in a burst at the end of
// a turn, so this is done per span, not per checkpoint. With no edits the held
// time goes back where it was held: today's behaviour exactly. Time is only
// ever moved between languages, never added.
//
// Pure: no vscode import.

export const ENGAGE_GRACE_MS = 5_000

interface Edits { events: number; lines: number }

// A span the user has left (engagement, pause) whose last edits may still be
// on their way: a measure runs 2 s+ after the change it reads. Edits stamped
// in [start, end] land here until the caller settles it.
interface Closed { start: number; end: number; held: Map<string, number>; edits: Map<string, Edits> }

export class AgentSpan {
  private engagedAt = 0
  private held = new Map<string, number>()
  private edits = new Map<string, Edits>()
  private closed: Closed | null = null

  // The user touched an editor (or a session started/resumed): a holding span
  // closes, and a new grace starts now.
  engage(now: number): void {
    this.close(now)
    this.engagedAt = now
    this.edits.clear()
  }

  // Stop holding at `now` (an engagement or a pause). The span waits in
  // `closed` for late edits; consecutive closes before a settle merge.
  close(now: number): void {
    if (this.held.size > 0) {
      const start = this.engagedAt + ENGAGE_GRACE_MS
      const c = this.closed ?? (this.closed = { start, end: now, held: new Map(), edits: new Map() })
      c.start = Math.min(c.start, start)
      c.end = Math.max(c.end, now)
      for (const [l, ms] of this.held) c.held.set(l, (c.held.get(l) ?? 0) + ms)
      mergeEdits(c.edits, this.edits)
    }
    this.held.clear()
    this.edits.clear()
  }

  // Whether an engagement at `now` needs a flush first.
  holding(now: number): boolean {
    return this.held.size > 0 || now > this.engagedAt + ENGAGE_GRACE_MS
  }

  // A language interval [from, to): returns the part to credit now; the part
  // past the grace is held under `language`.
  take(language: string, from: number, to: number): number {
    if (to <= from) return 0
    const boundary = this.engagedAt + ENGAGE_GRACE_MS
    const live = Math.max(0, Math.min(to, boundary) - from)
    const hold = to - from - live
    if (hold > 0) this.held.set(language, (this.held.get(language) ?? 0) + hold)
    return live
  }

  // One measured change to a file in `language`, `lines` its per-change
  // size, `at` when the change was first seen (not when it was measured).
  edit(language: string, lines: number, at: number): void {
    const c = this.closed
    const into = c && at >= c.start && at <= c.end ? c.edits
      : at >= this.engagedAt + ENGAGE_GRACE_MS ? this.edits
      : null
    if (!into) return
    const e = into.get(language) ?? { events: 0, lines: 0 }
    e.events++
    e.lines += lines
    into.set(language, e)
  }

  // The end of the closed span awaiting late edits, or null.
  closedUntil(): number | null {
    return this.closed?.end ?? null
  }

  // Where the closed span's held time goes; clears it.
  settle(): [string, number][] {
    const c = this.closed
    this.closed = null
    return c ? allocate(c.held, c.edits) : []
  }

  // Where all held time goes, closed and open: a session or day is ending and
  // cannot wait. Keeps the span open: time after this is still held until an
  // engagement. `keepEdits` (midnight): the open span's edits stay to weight
  // the time held after the split — it is the same agent turn.
  resolve(keepEdits = false): [string, number][] {
    const held = new Map(this.held)
    const edits = new Map<string, Edits>()
    mergeEdits(edits, this.edits)
    if (this.closed) {
      for (const [l, ms] of this.closed.held) held.set(l, (held.get(l) ?? 0) + ms)
      mergeEdits(edits, this.closed.edits)
    }
    this.closed = null
    this.held.clear()
    if (!keepEdits) this.edits.clear()
    return allocate(held, edits)
  }

  reset(): void {
    this.engagedAt = 0
    this.closed = null
    this.held.clear()
    this.edits.clear()
  }
}

function mergeEdits(into: Map<string, Edits>, from: Map<string, Edits>): void {
  for (const [l, e] of from) {
    const t = into.get(l) ?? { events: 0, lines: 0 }
    t.events += e.events
    t.lines += e.lines
    into.set(l, t)
  }
}

// Integer ms that sum exactly to the held total, shared by edit events; the
// rounding remainder goes to the most-edited language (lines, then name, break
// ties). No edits: each language gets back what was held under it.
function allocate(heldMap: Map<string, number>, editMap: Map<string, Edits>): [string, number][] {
  let total = 0
  for (const ms of heldMap.values()) total += ms
  if (total <= 0) return []
  const held = [...heldMap].filter(([, ms]) => ms > 0)
  const edits = [...editMap]
  if (edits.length === 0) return held

  edits.sort(([la, a], [lb, b]) => b.events - a.events || b.lines - a.lines || (la < lb ? -1 : la > lb ? 1 : 0))
  const events = edits.reduce((s, [, e]) => s + e.events, 0)
  const out = edits.map(([l, e]) => [l, Math.floor((total * e.events) / events)] as [string, number])
  out[0][1] += total - out.reduce((s, [, ms]) => s + ms, 0)
  return out.filter(([, ms]) => ms > 0)
}

// Lines changed between two contents, as a bag: what one save changed, not
// the day's net (a rewrite and its revert are two changes).
export function changedLines(a: number[], b: number[]): number {
  const counts = new Map<number, number>()
  for (const h of a) counts.set(h, (counts.get(h) ?? 0) + 1)
  let added = 0
  for (const h of b) {
    const n = counts.get(h) ?? 0
    if (n > 0) counts.set(h, n - 1)
    else added++
  }
  let removed = 0
  for (const n of counts.values()) removed += n
  return added + removed
}
