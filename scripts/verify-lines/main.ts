// Recomputes a day's expected net lines per file for git repos and compares
// them with the mirror. Expected = multiset diff of each file's current content
// against its content in the repo's baseline commit B for that day (the same
// rule and exclusions the tracker uses). Gitignored files (CLAUDE.md) have no
// record of their morning content and are listed as "unverifiable", not
// compared. Only meaningful for today: B's working-tree side is the disk now.
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { Git, MAX_BLOB_BYTES } from "../../src/tracker/gitBaseline"
import { isExcludedPath, languageForFile, normalizePath, worktreeInfo } from "../../src/tracker/pathRules"
import { Diff, compare, netDiff } from "./core"

const USAGE = "usage: node scripts/verify-lines.js [YYYY-MM-DD] --repo <path> [--repo …] [--mirror <dir>]"
function usage(): never { console.error(USAGE); process.exit(2) }

function args() {
  const a = process.argv.slice(2)
  const repos: string[] = []
  let date = "", mirror = ""
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--repo" || a[i] === "--mirror") {
      const v = a[++i]
      if (!v || v.startsWith("--")) usage()
      if (a[i - 1] === "--repo") repos.push(path.resolve(v)); else mirror = v
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(a[i]) && !date) date = a[i]
    else usage()
  }
  const d = new Date()
  if (!date) date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  if (!mirror) {
    const base = process.platform === "win32" ? process.env.APPDATA! : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config")
    mirror = path.join(base, "Code", "User", "globalStorage", "rabbit-hole.rabbit-hole", "mirror")
  }
  if (repos.length === 0) usage()
  return { repos, date, mirror }
}

async function main() {
  const { repos, date, mirror } = args()
  const [y, m, dd] = date.split("-").map(Number)
  const midnight = new Date(y, m - 1, dd).getTime()
  const git = new Git()
  const expected = new Map<string, Diff>()
  for (const repo of repos) {
    const base = await git.baselineFor(repo, await git.reflog(repo), midnight)
    if (!base) { console.log(`${repo}: no baseline commit, skipped`); continue }
    const names = new Set(await git.diffNames(repo, base))
    for (const rel of (await git.status(repo)).untracked) names.add(rel)
    for (const rel of names) {
      const p = path.join(repo, ...rel.split("/"))
      if (worktreeInfo(p) || isExcludedPath(p) || !languageForFile(path.basename(p))) continue
      const [blob] = await git.readBlobs(repo, base, [rel])
      if (blob === "unknown") continue
      const before = blob === "missing" ? "" : blob.toString("utf8")
      // the tracker skips a file over 5 MB, never treating it as a deletion
      if (fs.existsSync(p) && fs.statSync(p).size > MAX_BLOB_BYTES) continue
      const after = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""
      const d = netDiff(before, after)
      if (d.added || d.deleted) expected.set(normalizePath(p), d)
    }
  }
  const dayFile = path.join(mirror, "days", `${date}.json`)
  let text: string
  try { text = fs.readFileSync(dayFile, "utf8") } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") { console.error(`no mirror file for ${date} at ${dayFile}`); process.exit(2) }
    throw e
  }
  const day = JSON.parse(text)
  const recorded = new Map<string, Diff>()
  const unverifiable: string[] = []
  for (const log of Object.values(day.projects) as { files?: { path: string; linesAdded: number; linesDeleted: number }[] }[])
    for (const f of log.files ?? []) {
      const repo = repos.find(r => normalizePath(f.path).startsWith(normalizePath(r) + "/"))
      if (!repo) continue
      // a gitignored file (CLAUDE.md) has no record of its morning content to check against
      if (await git.run(repo, ["check-ignore", "-q", f.path]).then(() => true, () => false)) { unverifiable.push(f.path); continue }
      const k = normalizePath(f.path)
      const prev = recorded.get(k) ?? { added: 0, deleted: 0 }
      recorded.set(k, { added: prev.added + f.linesAdded, deleted: prev.deleted + f.linesDeleted })
    }
  const sum = (mm: Map<string, Diff>) => [...mm.values()].reduce((s, d) => ({ added: s.added + d.added, deleted: s.deleted + d.deleted }), { added: 0, deleted: 0 })
  const e = sum(expected), r = sum(recorded)
  console.log(`expected +${e.added} -${e.deleted} across ${expected.size} files; recorded +${r.added} -${r.deleted} across ${recorded.size} files`)
  if (unverifiable.length) console.log(`unverifiable (gitignored):\n${unverifiable.map(p => "  " + p).join("\n")}`)
  const mismatches = compare(expected, recorded)
  for (const mm of mismatches) console.log(`  ${mm.path}: expected +${mm.expected.added} -${mm.expected.deleted}, recorded +${mm.recorded.added} -${mm.recorded.deleted}`)
  console.log(mismatches.length === 0 ? "no mismatches" : `${mismatches.length} mismatch(es) — check each against the spec's accepted limits`)
  process.exit(mismatches.length === 0 ? 0 : 1)
}

main().catch(e => { console.error("verify-lines: " + (e instanceof Error ? e.message : String(e))); process.exit(2) })
