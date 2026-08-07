import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { DailyLog, ProjectMeta } from "../shared/types"
import { PROJECTS_KEY } from "./storageService"
import {
  DateKeyGroup,
  GlobalDayRecord,
  MirrorSink,
  buildDayFile,
  buildMetaFile,
  dayFileName,
  groupKeysByDate,
  needsBackfill,
} from "./mirrorFormat"

// saveCheckpoint runs every 10s while the user is active, so log writes are
// hot; coalesce them instead of touching the disk on every globalState update.
const FLUSH_DEBOUNCE_MS = 5_000

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  // The CLI may read at any instant, so the file is only ever swapped in whole.
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8")
  await fs.rename(tmp, filePath)
}

export class MirrorService implements MirrorSink {
  private readonly root: string
  private readonly daysDir: string
  private readonly metaPath: string
  private readonly dirtyDates = new Set<string>()
  private metaDirty = false
  private backfillSettled = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private context: vscode.ExtensionContext) {
    this.root = path.join(context.globalStorageUri.fsPath, "mirror")
    this.daysDir = path.join(this.root, "days")
    this.metaPath = path.join(this.root, "meta.json")
  }

  start(): void {
    // A long history could mean hundreds of files; never on the activation path.
    setTimeout(() => this.enqueue(() => this.backfillIfStale()), 0)
  }

  markDayDirty(date: string): void {
    if (this.disposed) return
    this.dirtyDates.add(date)
    this.schedule()
  }

  markProjectsDirty(): void {
    if (this.disposed) return
    this.metaDirty = true
    this.schedule()
  }

  // Awaited by deactivate() so a shutdown between debounce ticks is not lost.
  async dispose(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.enqueue(() => this.writePending())
    this.disposed = true
  }

  private schedule(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.enqueue(() => this.writePending())
    }, FLUSH_DEBOUNCE_MS)
  }

  // Serialises every disk operation so a backfill and a debounced flush can
  // never write the same file at the same time.
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(work).catch(err => this.report(err))
    return this.queue
  }

  private async writePending(): Promise<void> {
    // Nothing may write meta.json until backfill has finished, because meta is
    // what marks the mirror complete. A backfill that died partway leaves no
    // meta on purpose, so the next activation retries it — but a flush writing
    // meta would stamp the current schema over that gap, needsBackfill would
    // stop returning true, and the mirror would stay permanently short of
    // history while the CLI went on preferring it.
    if (!this.backfillSettled) return

    const dates = [...this.dirtyDates]
    if (dates.length === 0 && !this.metaDirty) return

    await this.ensureDirs()
    const groups = groupKeysByDate(this.context.globalState.keys())
    for (const date of dates) {
      const group = groups.get(date)
      if (group) await this.writeDay(group)
      // Cleared only once written, so a failed flush retries the day instead
      // of dropping it until something happens to touch that date again.
      this.dirtyDates.delete(date)
    }
    // updatedAt is the time of the last mirror write, so meta trails every flush.
    await this.writeMeta()
    this.metaDirty = false
  }

  private async backfillIfStale(): Promise<void> {
    let raw: string | null = null
    try {
      raw = await fs.readFile(this.metaPath, "utf8")
    } catch {
      raw = null
    }
    if (!needsBackfill(raw)) {
      this.backfillSettled = true
      return
    }

    await this.ensureDirs()
    for (const group of groupKeysByDate(this.context.globalState.keys()).values()) {
      await this.writeDay(group)
    }
    await this.writeMeta()
    // Last, and only on the success path: a throw above leaves this false, so
    // no flush can seal the incomplete mirror and the retry survives.
    this.backfillSettled = true
  }

  private async writeDay(group: DateKeyGroup): Promise<void> {
    const projects: Record<string, DailyLog> = {}
    for (const ref of group.logs) {
      // Mirrored verbatim — no trimming or recomputation; globalState is the
      // authority and the CLI expects exactly what it stored.
      const log = this.context.globalState.get<DailyLog>(ref.key)
      if (log) projects[ref.projectId] = log
    }
    const global = group.globalKey
      ? this.context.globalState.get<GlobalDayRecord>(group.globalKey) ?? null
      : null
    await writeJsonAtomic(
      path.join(this.daysDir, dayFileName(group.date)),
      buildDayFile(group.date, projects, global)
    )
  }

  private async writeMeta(): Promise<void> {
    const projects = this.context.globalState.get<ProjectMeta[]>(PROJECTS_KEY) ?? []
    const version = (this.context.extension?.packageJSON?.version as string | undefined) ?? "0.0.0"
    await writeJsonAtomic(
      this.metaPath,
      buildMetaFile(`rabbit-hole ${version}`, new Date(), projects)
    )
  }

  private async ensureDirs(): Promise<void> {
    // VS Code does not create globalStorageUri for us.
    await fs.mkdir(this.daysDir, { recursive: true })
  }

  // The mirror is secondary: it reports and gives up, tracking carries on.
  private report(err: unknown): void {
    console.error("Rabbit Hole: JSON mirror write failed", err)
  }
}
