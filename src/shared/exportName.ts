// File names for exports, shared by the webview (shown in the dialog) and the
// host (the save dialog's default) so the two can't disagree. Pure: no vscode.
export type ExportExt = "jpg" | "pdf" | "csv" | "json"

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "export"

// rabbithole-<project>-<day>.<ext> for one day, rabbithole-<project>-<n>d-to-<day>.<ext> for a range.
export function exportFileName(project: string, to: string, days: number, ext: ExportExt): string {
  return `rabbithole-${slug(project)}-${days <= 1 ? to : `${days}d-to-${to}`}.${ext}`
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

// One path segment of safe characters with the right extension, whatever the
// webview sent: the save dialog opens on it inside a folder the host chose.
export function safeFileName(name: unknown, ext: ExportExt): string {
  const base = typeof name === "string" ? name.split(/[\\/]/).pop() ?? "" : ""
  let stem = base.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 120)
  if (!stem) stem = "rabbithole-export"
  if (RESERVED.test(stem)) stem = "rabbithole-" + stem
  return `${stem}.${ext}`
}
