// The morning store's git half: which commit stands for "this repo at local
// midnight" (the baseline B) and how to read files out of it. The parsers and
// chooseBaseline are pure; the Git runner below shells out with a timeout. No
// vscode import, so it is tested against real repositories.

export const MAX_BLOB_BYTES = 5 * 1024 * 1024

export interface ReflogEntry { sha: string; time: number; action: string }

// `git reflog show --date=unix --format=%H%x09%gd%x09%gs HEAD`, newest first.
export function parseReflog(out: string): ReflogEntry[] {
  const entries: ReflogEntry[] = []
  for (const raw of out.split("\n")) {
    const m = /^([0-9a-f]{40,64})\t[^\t]*@\{(\d+)\}\t(.*)$/.exec(raw.replace(/\r$/, ""))
    if (m) entries.push({ sha: m[1], time: Number(m[2]) * 1000, action: m[3] })
  }
  return entries
}

// A commit is today's authorship and keeps the baseline. Everything else HEAD's
// reflog records (checkout, merge, pull, reset, rebase, cherry-pick, revert,
// clone, am) rewrote the working tree — what the live tracker absorbs.
export function isAuthorship(action: string): boolean {
  const head = action.split(": ")[0]
  return head === "commit" || head === "commit (amend)" || head === "commit (initial)"
}

export function chooseBaseline(newestFirst: ReflogEntry[], midnightMs: number): string | null {
  const entries = [...newestFirst].reverse()
  if (entries.length === 0) return null
  let b: string | null = null
  let i = 0
  while (i < entries.length && entries[i].time < midnightMs) b = entries[i++].sha
  if (b === null) b = entries[i++].sha // cloned or initialised today
  for (; i < entries.length; i++) if (!isAuthorship(entries[i].action)) b = entries[i].sha
  return b
}

export interface StatusLists { tracked: string[]; untracked: string[]; ignored: string[] }

// `git status --porcelain=v1 -z`. A rename/copy is followed by its old path.
export function parseStatus(out: string): StatusLists {
  const lists: StatusLists = { tracked: [], untracked: [], ignored: [] }
  const parts = out.split("\0")
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.length < 4) continue
    const xy = p.slice(0, 2)
    const file = p.slice(3)
    if (xy === "??") lists.untracked.push(file)
    else if (xy === "!!") lists.ignored.push(file)
    else {
      lists.tracked.push(file)
      if ((xy[0] === "R" || xy[0] === "C") && i + 1 < parts.length) lists.tracked.push(parts[++i])
    }
  }
  return lists
}

export type BlobResult = Buffer | "missing" | "unknown"

const LFS_HEADER = Buffer.from("version https://git-lfs.github.com/spec/")
export function isLfsPointer(b: Buffer): boolean {
  return b.length < 1024 && b.subarray(0, LFS_HEADER.length).equals(LFS_HEADER)
}

// `git cat-file --batch` output for `count` requests, in order. Anything that
// is not a readable text blob within the limit is "unknown"; a path absent from
// the commit is "missing" (the file did not exist at midnight).
export function parseBatch(out: Buffer, count: number, maxBytes = MAX_BLOB_BYTES): BlobResult[] {
  const results: BlobResult[] = []
  let pos = 0
  while (results.length < count && pos < out.length) {
    const nl = out.indexOf(0x0a, pos)
    if (nl < 0) break
    const header = out.subarray(pos, nl).toString("utf8")
    pos = nl + 1
    if (header.endsWith(" missing")) { results.push("missing"); continue }
    if (header.endsWith(" ambiguous")) { results.push("unknown"); continue }
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header)
    if (!m) break
    const size = Number(m[2])
    if (pos + size > out.length) break
    const body = out.subarray(pos, pos + size)
    pos += size + 1
    results.push(m[1] !== "blob" || size > maxBytes || isLfsPointer(body) ? "unknown" : body)
  }
  while (results.length < count) results.push("unknown")
  return results
}
