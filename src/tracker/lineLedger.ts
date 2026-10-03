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

// `base` is the signed multiset of start-of-day content, shifted by suppressed
// changes. It is materialised only while the file has net change today; when
// `base` is null it equals bag(last) by definition. The extension host is shared
// and long-lived, so holding a per-line Map for every file ever sighted (every
// file a branch switch touched, every document any extension opened) would grow
// without bound — a bare hash array is what the old baselines cost.
interface Entry {
  base: Map<number, number> | null
  last: LineHashes          // latest observed content ([] once deleted)
  present: LineHashes       // latest content while the file existed
  credited: LineDelta       // net already reported for this file today
  edited: boolean           // ever credited a change this session (survives midnight)
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

const ZERO: LineDelta = { added: 0, deleted: 0 }

export class LineLedger {
  private entries = new Map<string, Entry>()
  private day = ""

  has(path: string): boolean {
    return this.entries.has(path)
  }

  lastPresent(path: string): LineHashes | undefined {
    return this.entries.get(path)?.present
  }

  // Whether an authored change to this file has been credited this session.
  wasEdited(path: string): boolean {
    return this.entries.get(path)?.edited ?? false
  }

  // Diagnostic: files tracked, and how many hold a materialised line bag.
  stats(): { files: number; bags: number } {
    let bags = 0
    for (const e of this.entries.values()) if (e.base) bags++
    return { files: this.entries.size, bags }
  }

  // Record a sighting without crediting it (an editor opening a file), so the
  // first edit to an open file is measurable. No-op if already tracked.
  prime(path: string, hashes: LineHashes, day: string): void {
    this.rollover(day)
    if (this.entries.has(path)) return
    this.entries.set(path, { base: null, last: hashes, present: hashes, credited: ZERO, edited: false })
  }

  // The change to credit since the previous report (may be negative), or null
  // when there is nothing to credit.
  observe(path: string, hashes: LineHashes, opts: ObserveOptions): LineDelta | null {
    this.rollover(opts.day)
    let e = this.entries.get(path)
    if (!e) {
      const start = opts.isCreate ? (opts.seed ?? []) : hashes
      e = { base: null, last: start, present: start, credited: ZERO, edited: false }
      this.entries.set(path, e)
      // Pre-existing file with no baseline: the edit that brought us here is unmeasurable.
      if (!opts.isCreate) return null
    }

    if (opts.suppress) {
      // With no bag, base == bag(last), and shifting it by (hashes - last)
      // gives bag(hashes) — so it stays implicit.
      if (e.base) shift(e.base, e.last, hashes)
      e.last = hashes
      if (hashes.length > 0) e.present = hashes
      return null
    }

    const base = e.base ?? bag(e.last)
    e.last = hashes
    if (hashes.length > 0) e.present = hashes
    const net = netDiff(base, hashes)
    // Net zero means current == base exactly, so the bag can be dropped.
    e.base = net.added === 0 && net.deleted === 0 ? null : base
    const delta = { added: net.added - e.credited.added, deleted: net.deleted - e.credited.deleted }
    e.credited = net
    if (delta.added === 0 && delta.deleted === 0) return null
    e.edited = true
    return delta
  }

  // A new day starts every file from its last content: nothing credited, no bag.
  private rollover(day: string): void {
    if (day === this.day) return
    this.day = day
    for (const e of this.entries.values()) {
      e.base = null
      e.credited = ZERO
    }
  }
}
