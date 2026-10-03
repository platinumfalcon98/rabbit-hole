// Per-file, per-day NET line accounting — what `git diff` against the file's
// start-of-day content would report. Pure (no vscode import) so it is unit
// tested directly.
//
// Why net: the old gross model added every observed change, so any phantom
// change (an open file reloaded as one huge span, a branch switch, a temp copy)
// was counted forever. Under net accounting a change that is later undone
// cancels, and an agent rewriting the same function ten times counts once.

export type LineHashes = number[]

export interface LineDelta { added: number; deleted: number }

export interface ObserveOptions {
  day: string
  // The file did not exist before: its start-of-day content is empty (or `seed`).
  isCreate?: boolean
  // Start-of-day content for a created file — a worktree file starts as the main
  // checkout's copy, so the checkout itself is not authorship.
  seed?: LineHashes
  // A git operation (or worktree removal/merge) produced this change: absorb it
  // into the baseline instead of crediting it.
  suppress?: boolean
}

interface Entry {
  day: string
  base: Map<number, number> // signed multiset: start-of-day content, shifted by suppressed changes
  last: LineHashes          // latest observed content ([] once deleted)
  present: LineHashes       // latest content while the file existed
  credited: LineDelta       // net already reported for this file today
}

// FNV-1a 32-bit. Collisions (~0.3% across a 5000-line file) can mask a changed
// line, so counts are close but not exact.
export function hashLine(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// One hash per line. CR is stripped so a CRLF<->LF flip is not a rewrite, and the
// empty string after a trailing newline is not a line ("a\nb\n" is 2 lines).
export function hashLines(text: string): LineHashes {
  if (text.length === 0) return []
  const lines = text.split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  return lines.map(l => hashLine(l.endsWith("\r") ? l.slice(0, -1) : l))
}

function bag(hashes: LineHashes): Map<number, number> {
  const m = new Map<number, number>()
  for (const x of hashes) m.set(x, (m.get(x) ?? 0) + 1)
  return m
}

function netDiff(base: Map<number, number>, current: LineHashes): LineDelta {
  const cur = bag(current)
  let added = 0
  let deleted = 0
  for (const [x, c] of cur) {
    const d = c - (base.get(x) ?? 0)
    if (d > 0) added += d
    else deleted -= d
  }
  for (const [x, b] of base) {
    if (cur.has(x)) continue
    if (b > 0) deleted += b
    else added -= b // negative base: a line authored today that a git op removed
  }
  return { added, deleted }
}

// base += (to - from), so current - base is unchanged by the suppressed change.
function shift(base: Map<number, number>, from: LineHashes, to: LineHashes): void {
  for (const x of from) base.set(x, (base.get(x) ?? 0) - 1)
  for (const x of to) base.set(x, (base.get(x) ?? 0) + 1)
}

export class LineLedger {
  private entries = new Map<string, Entry>()

  has(path: string): boolean {
    return this.entries.has(path)
  }

  lastPresent(path: string): LineHashes | undefined {
    return this.entries.get(path)?.present
  }

  // Record a sighting without crediting it (an editor opening a file), so the
  // first edit to an open file is measurable. No-op if already tracked.
  prime(path: string, hashes: LineHashes, day: string): void {
    if (this.entries.has(path)) return
    this.entries.set(path, { day, base: bag(hashes), last: hashes, present: hashes, credited: { added: 0, deleted: 0 } })
  }

  // The change to credit since the previous report (may be negative), or null
  // when there is nothing to credit.
  observe(path: string, hashes: LineHashes, opts: ObserveOptions): LineDelta | null {
    let e = this.entries.get(path)
    if (!e) {
      const start = opts.isCreate ? (opts.seed ?? []) : hashes
      e = { day: opts.day, base: bag(start), last: start, present: start, credited: { added: 0, deleted: 0 } }
      this.entries.set(path, e)
      // Pre-existing file with no baseline: the edit that brought us here is unmeasurable.
      if (!opts.isCreate) return null
    }

    if (e.day !== opts.day) {
      e.base = bag(e.last)
      e.credited = { added: 0, deleted: 0 }
      e.day = opts.day
    }

    if (opts.suppress) shift(e.base, e.last, hashes)
    e.last = hashes
    if (hashes.length > 0) e.present = hashes
    if (opts.suppress) return null

    const net = netDiff(e.base, hashes)
    const delta = { added: net.added - e.credited.added, deleted: net.deleted - e.credited.deleted }
    e.credited = net
    return delta.added === 0 && delta.deleted === 0 ? null : delta
  }
}
