import { DailyLog, ProjectMeta } from "../shared/types"

// Pure half of the JSON mirror: key parsing and document construction, with no
// vscode or fs dependency so the shape can be reasoned about in isolation.

export const MIRROR_SCHEMA = 1

const LOG_PREFIX = "rabbithole:log:"
const GLOBAL_PREFIX = "rabbithole:global:"
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface GlobalDayRecord {
  activeTime: number
  streak: number
}

export interface MirrorDayFile {
  schema: number
  date: string
  global?: GlobalDayRecord
  projects: Record<string, DailyLog>
}

export interface MirrorMetaFile {
  schema: number
  generator: string
  updatedAt: string
  projects: ProjectMeta[]
}

export interface LogKeyRef {
  key: string
  projectId: string
  date: string
}

export interface DateKeyGroup {
  date: string
  logs: LogKeyRef[]
  globalKey: string | null
}

// Sink the StorageService writes into. Kept here so storageService does not
// have to depend on the fs-bound service.
export interface MirrorSink {
  markDayDirty(date: string): void
  markProjectsDirty(): void
}

export function parseLogKey(key: string): { projectId: string; date: string } | null {
  if (!key.startsWith(LOG_PREFIX)) return null
  const rest = key.slice(LOG_PREFIX.length)
  // Project ids contain colons of their own, so the date is everything after
  // the LAST colon. The pre-multi-project key shape has no project id at all.
  const cut = rest.lastIndexOf(":")
  const projectId = cut < 0 ? "" : rest.slice(0, cut)
  const date = cut < 0 ? rest : rest.slice(cut + 1)
  if (!DATE_RE.test(date)) return null
  return { projectId, date }
}

export function parseGlobalKey(key: string): { date: string } | null {
  if (!key.startsWith(GLOBAL_PREFIX)) return null
  const date = key.slice(GLOBAL_PREFIX.length)
  if (!DATE_RE.test(date)) return null
  return { date }
}

export function groupKeysByDate(keys: readonly string[]): Map<string, DateKeyGroup> {
  const groups = new Map<string, DateKeyGroup>()
  const groupFor = (date: string): DateKeyGroup => {
    let g = groups.get(date)
    if (!g) {
      g = { date, logs: [], globalKey: null }
      groups.set(date, g)
    }
    return g
  }

  for (const key of keys) {
    const log = parseLogKey(key)
    if (log) {
      groupFor(log.date).logs.push({ key, projectId: log.projectId, date: log.date })
      continue
    }
    const global = parseGlobalKey(key)
    if (global) groupFor(global.date).globalKey = key
  }
  return groups
}

export function buildDayFile(
  date: string,
  projects: Record<string, DailyLog>,
  global: GlobalDayRecord | null
): MirrorDayFile {
  const file: MirrorDayFile = { schema: MIRROR_SCHEMA, date, projects }
  // Legacy days predate the global rollup; the reader must be able to tell
  // "absent" from "zero", so the key is omitted rather than synthesised.
  if (global) file.global = { activeTime: global.activeTime, streak: global.streak }
  return file
}

export function buildMetaFile(
  generator: string,
  updatedAt: Date,
  projects: readonly ProjectMeta[]
): MirrorMetaFile {
  return {
    schema: MIRROR_SCHEMA,
    generator,
    updatedAt: toRfc3339Local(updatedAt),
    projects: projects.map(normalizeProjectMeta),
  }
}

function normalizeProjectMeta(p: ProjectMeta): ProjectMeta {
  const out: ProjectMeta = {
    id: p.id,
    name: p.name,
    path: p.path,
    detectionMethod: p.detectionMethod,
  }
  // An unset target means "no target", which is not a target of zero, so the
  // optional fields are dropped rather than defaulted.
  if (p.dailyTargetMinutes !== undefined) out.dailyTargetMinutes = p.dailyTargetMinutes
  if (p.streak !== undefined) out.streak = p.streak
  return out
}

export function toRfc3339Local(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const offsetMinutes = -d.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? "-" : "+"
  const abs = Math.abs(offsetMinutes)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const millis = String(d.getMilliseconds()).padStart(3, "0")
  return `${date}T${time}.${millis}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

export function dayFileName(date: string): string {
  return `${date}.json`
}

// True when an existing meta.json cannot be trusted to describe the current
// format and the whole mirror has to be rebuilt.
export function needsBackfill(rawMeta: string | null): boolean {
  if (rawMeta === null) return true
  try {
    const parsed = JSON.parse(rawMeta) as { schema?: unknown }
    return typeof parsed.schema !== "number" || parsed.schema < MIRROR_SCHEMA
  } catch {
    return true
  }
}
