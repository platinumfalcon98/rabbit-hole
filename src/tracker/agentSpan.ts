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

export class AgentSpan {
  private engagedAt = 0
  private held = new Map<string, number>()
  private edits = new Map<string, Edits>()

  // The user touched an editor (or a session started/resumed): a new grace
  // starts now. Edits from before belong to no span. The caller resolves any
  // held time first.
  engage(now: number): void {
    this.engagedAt = now
    this.edits.clear()
  }

  // Whether an engagement at `now` needs a flush and resolve first.
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

  // One measured change to a file in `language`, `lines` its per-change size.
  edit(language: string, lines: number, now: number): void {
    if (now < this.engagedAt + ENGAGE_GRACE_MS) return
    const e = this.edits.get(language) ?? { events: 0, lines: 0 }
    e.events++
    e.lines += lines
    this.edits.set(language, e)
  }

  // Where the held time goes. Integer ms that sum exactly to the held total;
  // the rounding remainder goes to the most-edited language (lines, then name,
  // break ties). Keeps the span open: time after this is still held until an
  // engagement.
  resolve(): [string, number][] {
    let total = 0
    for (const ms of this.held.values()) total += ms
    const held = [...this.held].filter(([, ms]) => ms > 0)
    const edits = [...this.edits]
    this.held.clear()
    this.edits.clear()
    if (total <= 0) return []
    if (edits.length === 0) return held

    edits.sort(([la, a], [lb, b]) => b.events - a.events || b.lines - a.lines || (la < lb ? -1 : la > lb ? 1 : 0))
    const events = edits.reduce((s, [, e]) => s + e.events, 0)
    const out = edits.map(([l, e]) => [l, Math.floor((total * e.events) / events)] as [string, number])
    out[0][1] += total - out.reduce((s, [, ms]) => s + ms, 0)
    return out.filter(([, ms]) => ms > 0)
  }

  reset(): void {
    this.engagedAt = 0
    this.held.clear()
    this.edits.clear()
  }
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
