// Pure core of the verify-lines acceptance tool: the expected net diff of a
// file, and the comparison against what the extension recorded.
export interface Diff { added: number; deleted: number }

function lines(t: string): string[] {
  if (!t) return []
  const l = t.replace(/\r/g, "").split("\n")
  if (l[l.length - 1] === "") l.pop()
  return l
}

export function netDiff(before: string, after: string): Diff {
  const bag = new Map<string, number>()
  for (const l of lines(before)) bag.set(l, (bag.get(l) ?? 0) + 1)
  let added = 0
  for (const l of lines(after)) { const n = bag.get(l) ?? 0; if (n > 0) bag.set(l, n - 1); else added++ }
  let deleted = 0
  for (const n of bag.values()) deleted += n
  return { added, deleted }
}

export function compare(expected: Map<string, Diff>, recorded: Map<string, Diff>) {
  const out: { path: string; expected: Diff; recorded: Diff }[] = []
  const zero = { added: 0, deleted: 0 }
  for (const p of new Set([...expected.keys(), ...recorded.keys()])) {
    const e = expected.get(p) ?? zero, r = recorded.get(p) ?? zero
    if (e.added !== r.added || e.deleted !== r.deleted) out.push({ path: p, expected: e, recorded: r })
  }
  return out
}
