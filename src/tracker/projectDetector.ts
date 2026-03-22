import * as vscode from "vscode"
import { execSync } from "child_process"
import { ProjectMeta } from "../shared/types"

function hashPath(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0
  }
  return Math.abs(h).toString(16)
}

function extractRepoName(remoteUrl: string): string {
  const trimmed = remoteUrl.trim()
  const match = trimmed.match(/\/([^/]+?)(?:\.git)?$/) ??
                trimmed.match(/:([^:/]+?)(?:\.git)?$/)
  return match ? match[1] : ""
}

const cache = new Map<string, ProjectMeta>()

export function detectProject(folder: vscode.WorkspaceFolder): ProjectMeta {
  const uri = folder.uri.toString()
  if (cache.has(uri)) return cache.get(uri)!

  const fsPath = folder.uri.fsPath
  const folderName = folder.name

  try {
    const remote = execSync("git remote get-url origin", {
      cwd: fsPath,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim()

    if (remote) {
      const repoName = extractRepoName(remote) || folderName
      const meta: ProjectMeta = {
        id: remote,
        name: repoName,
        path: fsPath,
        detectionMethod: "git-remote",
      }
      cache.set(uri, meta)
      return meta
    }
  } catch {
    // not a git repo or no origin remote — fall through
  }

  const meta: ProjectMeta = {
    id: `${folderName}:${hashPath(fsPath)}`,
    name: folderName,
    path: fsPath,
    detectionMethod: "folder-hash",
  }
  cache.set(uri, meta)
  return meta
}

export function clearDetectionCache(): void {
  cache.clear()
}
