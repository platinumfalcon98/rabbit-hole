# Rabbit Hole — Claude Code Build Prompt

Build a VS Code extension called **Rabbit Hole** — a dev time intelligence tool that automatically tracks coding activity, detects AI agent usage, and displays rich analytics in an in-editor dashboard. Everything runs locally — no backend, no accounts, no data leaving the machine.

---

## Stack

- **Language:** TypeScript (strict mode)
- **Bundler:** esbuild — two separate bundles (extension host + webview)
- **Charts:** Chart.js (bar, pie, stacked bar) + D3.js (calendar heatmap)
- **Storage:** VS Code `context.globalState` — no database, no backend
- **VS Code API:** `^1.85.0`

---

## Project Structure

```
rabbit-hole/
├── src/
│   ├── extension.ts
│   ├── shared/
│   │   └── types.ts
│   ├── tracker/
│   │   ├── activityTracker.ts
│   │   ├── agentDetector.ts
│   │   └── storageService.ts
│   ├── dashboard/
│   │   ├── dashboardPanel.ts
│   │   └── messageHandler.ts
│   └── webview/
│       ├── main.ts
│       ├── heatmap.ts
│       ├── charts.ts
│       └── index.html
├── out/                        # esbuild output — gitignore this
├── .vscode/
│   └── launch.json
├── package.json
├── tsconfig.json
└── .vscodeignore
```

---

## Implementation Order

Implement strictly in this order — each module depends on the previous:

1. `src/shared/types.ts`
2. `src/tracker/storageService.ts`
3. `src/tracker/activityTracker.ts`
4. `src/tracker/agentDetector.ts`
5. `src/dashboard/dashboardPanel.ts`
6. `src/dashboard/messageHandler.ts`
7. `src/webview/main.ts`
8. `src/webview/heatmap.ts`
9. `src/webview/charts.ts`
10. `src/webview/index.html`
11. `src/extension.ts`
12. `package.json`, `tsconfig.json`, `launch.json`, `.vscodeignore`

---

## Data Model — `src/shared/types.ts`

Use these interfaces exactly. Do not invent alternatives.

```typescript
export interface ActivitySession {
  id: string
  startTime: number        // unix ms
  endTime: number | null   // null if session still active
  duration: number         // accumulated ms, updated on pause/end
  idle: boolean            // true if ended by idle timeout
}

export interface FileActivity {
  path: string
  language: string         // detected from file extension
  linesAdded: number
  linesDeleted: number
  lastModified: number     // unix ms
}

export type AgentName =
  | "claude-code"
  | "copilot"
  | "cursor"
  | "continue"
  | "unknown-ai"
  | "manual"

export interface AgentEvent {
  agent: AgentName
  model?: string           // model string if detectable
  startTime: number
  endTime: number
  linesAdded: number
  linesDeleted: number
  filesChanged: string[]
  confidence: "high" | "low"
}

export interface LanguageStat {
  time: number
  linesAdded: number
  linesDeleted: number
}

export interface DailyLog {
  date: string                              // "YYYY-MM-DD"
  totalTime: number                         // ms including idle
  activeTime: number                        // ms excluding idle
  streak: number                            // consecutive coding days
  languages: Record<string, LanguageStat>
  agents: Record<AgentName, AgentEvent[]>
  files: FileActivity[]
  sessions: ActivitySession[]
}

// ── Message Protocol ──────────────────────────────────────────────────────

export type ExtensionMessage =
  | { type: "init";     data: DailyLog[] }
  | { type: "update";   data: DailyLog }
  | { type: "settings"; agentsEnabled: boolean }

export type WebviewMessage =
  | { type: "ready" }
  | { type: "requestRange"; days: 7 | 30 | 90 }
  | { type: "export"; format: "csv" | "json" }
```

---

## Storage Service — `src/tracker/storageService.ts`

- globalState key pattern: `rabbithole:log:YYYY-MM-DD`
- Expose these methods:

```typescript
class StorageService {
  constructor(private context: vscode.ExtensionContext) {}

  getToday(): DailyLog
  getRange(days: number): DailyLog[]
  appendSession(session: ActivitySession): void
  appendFileActivity(file: FileActivity): void
  appendAgentEvent(event: AgentEvent): void
  updateStreak(): void
  exportJSON(): string
  exportCSV(): string
}
```

- `getToday()` always returns a valid DailyLog — create empty one if missing
- `updateStreak()` checks yesterday's log exists, increments or resets streak
- Storage writes should merge into existing DailyLog, never overwrite entirely

---

## Activity Tracker — `src/tracker/activityTracker.ts`

### VS Code Events to Listen To

```typescript
vscode.workspace.onDidChangeTextDocument    // primary tracking signal
vscode.window.onDidChangeWindowState        // pause on focus loss
vscode.window.onDidChangeActiveTextEditor   // track file switches
vscode.window.onDidChangeActiveTerminal     // track terminal activity
```

### Session Logic

```typescript
// On any activity event:
// 1. Clear existing idle timer
// 2. Resume/start session if not active
// 3. Reset idle timer to IDLE_THRESHOLD (5 min default, configurable)

// On idle timer fire:
// 1. Pause current session (set idle: true)
// 2. Write session to StorageService

// On window focus lost:
// 1. Pause session immediately (don't wait for idle)

// On window focus gained:
// 1. Start new session
```

### Change Extraction

On `onDidChangeTextDocument`, extract:

```typescript
interface ChangeProfile {
  linesAdded: number
  linesDeleted: number
  fileCount: number           // files changed simultaneously
  totalCharsChanged: number
  timeMs: number              // ms since last change to this file
  changeRatio: number         // changed lines / total file lines
  isMultiSite: boolean        // changes in 3+ locations at once
  isAtomic: boolean           // delta < 50ms (AI-applied block)
  isSyntaxComplete: boolean   // added lines form a complete syntax block
  language: string            // from document.languageId
  filePath: string
}
```

Pass `ChangeProfile` to `AgentDetector.detect()` after extracting.

---

## Agent Detector — `src/tracker/agentDetector.ts`

### Detection Layers (run in priority order)

**Layer 1 — Claude Code file watcher (HIGH confidence)**
```typescript
const watcher = vscode.workspace.createFileSystemWatcher("**/.claude/**")
watcher.onDidChange(() => setAgentSignal("claude-code", Date.now()))
watcher.onDidCreate(() => setAgentSignal("claude-code", Date.now()))
```
If `.claude/` fired within the last `AGENT_COOLDOWN_MS` (15000ms), return `claude-code` with `confidence: "high"`.

**Layer 2 — App name (Cursor detection)**
```typescript
const isCursor = vscode.env.appName.toLowerCase().includes("cursor")
```
If true, attribute all AI-heuristic matches to `cursor`.

**Layer 3 — Extension presence**
```typescript
const EXTENSION_IDS: Record<AgentName, string> = {
  "copilot":  "GitHub.copilot",
  "continue": "Continue.continue",
}
function isActive(id: string): boolean {
  return !!vscode.extensions.getExtension(id)?.isActive
}
```

**Layer 4 — Timing fingerprint profiles**
```typescript
const AGENT_PROFILES = {
  "claude-code": { maxLines: 500, maxTimeMs: 8000, pattern: "bulk" },
  "cursor":      { maxLines: 200, maxTimeMs: 3000, pattern: "bulk" },
  "continue":    { maxLines: 50,  maxTimeMs: 1500, pattern: "block" },
  "copilot":     { maxLines: 15,  maxTimeMs: 800,  pattern: "incremental" },
}
```
Match `ChangeProfile` against profiles when multiple agents are installed.

**Layer 5 — Heuristic classifier**
```typescript
function isLikelyAI(profile: ChangeProfile): boolean {
  if (profile.linesAdded > 10 && profile.timeMs < 1500) return true
  if (profile.changeRatio > 0.3 && profile.timeMs < 3000) return true
  if (profile.isMultiSite && profile.isAtomic) return true
  if (profile.isSyntaxComplete && profile.linesAdded > 5) return true
  return false
}
```

**Layer 6 — Session correlation window**
```typescript
// If a known agent signal fired within AGENT_COOLDOWN_MS, attribute to that agent
// even if the current change alone wouldn't trigger detection
```

**Layer 7 — User confirmation (low confidence fallback)**
```typescript
// If confidence would be "low" and user hasn't set a preference for this pattern:
// Show one-time information message:
// "Rabbit Hole: Detected a large change — was this AI-assisted?"
// [Yes — Claude Code] [Yes — Copilot] [Yes — Other] [No]
// Store answer in globalState key: rabbithole:userConfirmation:<hash>
```

### Toggle Gating

Before any detection, check:
```typescript
const config = vscode.workspace.getConfiguration("rabbithole")
if (!config.get("detectAgents")) return { agent: "manual", confidence: "high", ... }

const agentToggles = config.get("agents") as Record<string, boolean>
// Skip detection for disabled agents
```

### detect() return signature
```typescript
function detect(profile: ChangeProfile): AgentEvent {
  // runs all layers, returns AgentEvent with best attribution
}
```

---

## Dashboard Panel — `src/dashboard/dashboardPanel.ts`

- Singleton pattern — only one panel open at a time
- Store panel reference, dispose on panel close
- Inject bundled `main.js` and `style.css` URIs via `webview.asWebviewUri()`
- Set Content Security Policy to allow local scripts only
- On `panel.onDidDispose` — clear singleton reference

```typescript
class DashboardPanel {
  static currentPanel: DashboardPanel | undefined
  static createOrShow(context: vscode.ExtensionContext): void
  dispose(): void
  postMessage(message: ExtensionMessage): void
}
```

---

## Message Handler — `src/dashboard/messageHandler.ts`

```typescript
function handleMessage(
  msg: WebviewMessage,
  storage: StorageService,
  panel: DashboardPanel
): void {
  switch (msg.type) {
    case "ready":
      panel.postMessage({ type: "init", data: storage.getRange(30) })
      break
    case "requestRange":
      panel.postMessage({ type: "init", data: storage.getRange(msg.days) })
      break
    case "export":
      const content = msg.format === "csv"
        ? storage.exportCSV()
        : storage.exportJSON()
      // Write to workspace root or prompt save dialog
      break
  }
}
```

---

## Webview Entry — `src/webview/main.ts`

```typescript
const vscode = acquireVsCodeApi()

// On load — signal ready
vscode.postMessage({ type: "ready" })

// Receive messages from extension
window.addEventListener("message", (event) => {
  const msg: ExtensionMessage = event.data
  switch (msg.type) {
    case "init":
      heatmap.render(msg.data)
      charts.renderAll(msg.data)
      updateStatCards(msg.data[msg.data.length - 1])
      break
    case "update":
      charts.updateToday(msg.data)
      updateStatCards(msg.data)
      break
  }
})

// Range selector
document.getElementById("range")?.addEventListener("change", (e) => {
  const days = parseInt((e.target as HTMLSelectElement).value) as 7 | 30 | 90
  vscode.postMessage({ type: "requestRange", days })
})
```

---

## Heatmap — `src/webview/heatmap.ts`

- Use D3.js to render a GitHub-style calendar heatmap
- X axis = weeks, Y axis = days of week (Mon–Sun)
- Cell colour intensity based on `totalTime` — use a sequential colour scale
- Empty days = lightest colour, not transparent (matches GitHub style)
- Tooltip on hover: date + total time formatted as "Xh Ym"
- Accepts `DailyLog[]`, maps by `log.date`

---

## Charts — `src/webview/charts.ts`

Three Chart.js instances:

**1. Lines Bar Chart** (`lines-chart` canvas)
- X axis = dates, grouped bars: linesAdded (green) vs linesDeleted (red)
- Data from `DailyLog[].linesAdded` / `linesDeleted` summed across files

**2. Language Pie Chart** (`lang-chart` canvas)
- Segments = languages, sized by time spent
- Labels show language name + percentage
- Data from `DailyLog.languages` record (today or selected range summed)

**3. Agent Stacked Bar** (`agent-chart` canvas)
- X axis = dates, stacked segments per agent
- Colours: claude-code = purple, copilot = blue, cursor = teal, continue = green, manual = gray
- Data from `DailyLog[].agents` record

Expose:
```typescript
export function renderAll(logs: DailyLog[]): void
export function updateToday(log: DailyLog): void
```

---

## Webview HTML — `src/webview/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline';">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="header">
    <h1>Rabbit Hole</h1>
    <div id="streak">🔥 <span id="streak-count">0</span> day streak</div>
    <select id="range">
      <option value="7">Last 7 days</option>
      <option value="30" selected>Last 30 days</option>
      <option value="90">Last 90 days</option>
    </select>
  </div>

  <div id="stat-cards">
    <div class="stat-card"><div class="stat-label">Active Time</div><div class="stat-value" id="stat-time">—</div></div>
    <div class="stat-card"><div class="stat-label">Lines Added</div><div class="stat-value" id="stat-added">—</div></div>
    <div class="stat-card"><div class="stat-label">Lines Deleted</div><div class="stat-value" id="stat-deleted">—</div></div>
    <div class="stat-card"><div class="stat-label">AI Assisted</div><div class="stat-value" id="stat-ai">—</div></div>
  </div>

  <div id="heatmap"></div>

  <div class="chart-grid">
    <div class="chart-box"><canvas id="lines-chart"></canvas></div>
    <div class="chart-box"><canvas id="lang-chart"></canvas></div>
    <div class="chart-box chart-wide"><canvas id="agent-chart"></canvas></div>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>
```

Style using VS Code CSS variables:
```css
body {
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  padding: 16px;
}
```

---

## Extension Entry — `src/extension.ts`

```typescript
export function activate(context: vscode.ExtensionContext) {
  const storage = new StorageService(context)
  const detector = new AgentDetector(context)
  const tracker = new ActivityTracker(context, storage, detector)

  tracker.start()

  // Live update interval — push to dashboard every 30s if visible
  const interval = setInterval(() => {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.postMessage({
        type: "update",
        data: storage.getToday()
      })
    }
  }, 30_000)

  context.subscriptions.push(
    vscode.commands.registerCommand("rabbithole.openDashboard", () => {
      DashboardPanel.createOrShow(context)
    }),
    vscode.commands.registerCommand("rabbithole.toggleAgentDetection", () => {
      const config = vscode.workspace.getConfiguration("rabbithole")
      const current = config.get("detectAgents") as boolean
      config.update("detectAgents", !current, vscode.ConfigurationTarget.Global)
    }),
    { dispose: () => clearInterval(interval) }
  )
}

export function deactivate() {}
```

---

## package.json

```json
{
  "name": "rabbit-hole",
  "displayName": "Rabbit Hole",
  "description": "Dev time intelligence — automatic tracking, AI agent attribution, activity dashboard",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "rabbithole.openDashboard",
        "title": "Rabbit Hole: Open Dashboard",
        "icon": "$(clock)"
      },
      {
        "command": "rabbithole.toggleAgentDetection",
        "title": "Rabbit Hole: Toggle Agent Detection"
      }
    ],
    "configuration": {
      "title": "Rabbit Hole",
      "properties": {
        "rabbithole.detectAgents": {
          "type": "boolean",
          "default": true,
          "description": "Detect and log AI agent activity"
        },
        "rabbithole.idleThresholdMinutes": {
          "type": "number",
          "default": 5,
          "description": "Minutes of inactivity before session is paused"
        },
        "rabbithole.agents": {
          "type": "object",
          "default": {},
          "properties": {
            "claudeCode": { "type": "boolean", "default": true },
            "copilot":    { "type": "boolean", "default": true },
            "cursor":     { "type": "boolean", "default": true },
            "continue":   { "type": "boolean", "default": true }
          },
          "description": "Toggle detection per AI agent"
        }
      }
    }
  },
  "scripts": {
    "build": "npm run build:ext && npm run build:webview",
    "build:ext": "esbuild src/extension.ts --bundle --outfile=out/extension.js --external:vscode --platform=node --sourcemap",
    "build:webview": "esbuild src/webview/main.ts --bundle --outfile=out/webview/main.js --platform=browser --sourcemap",
    "watch": "npm run build:ext -- --watch & npm run build:webview -- --watch",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/d3": "^7.4.0",
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.3.0"
  },
  "dependencies": {
    "chart.js": "^4.4.0",
    "d3": "^7.9.0"
  }
}
```

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020", "DOM"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "out"]
}
```

---

## .vscode/launch.json

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/out/**/*.js"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

---

## .vscodeignore

```
src/
node_modules/
.vscode/
**/*.ts
**/*.map
**/*.js.map
```

---

## Critical Rules — Do Not Deviate

- `--external:vscode` in the esbuild ext bundle — never bundle the vscode module
- `activationEvents: ["onStartupFinished"]` — extension auto-starts, no manual trigger
- globalState key pattern: `rabbithole:log:YYYY-MM-DD`
- All agent toggle checks must go through `vscode.workspace.getConfiguration("rabbithole")`
- `.claude/` file watcher is the highest-confidence signal — implement it first in agentDetector
- Webview styling uses VS Code CSS variables exclusively — no hardcoded colours
- `DashboardPanel` must clear its singleton reference in `onDidDispose`
- Chart.js and D3 must be bundled locally — no CDN imports in webview
- `DailyLog.agents` is `Record<AgentName, AgentEvent[]>` — always initialise all agent keys as empty arrays to avoid undefined checks
- Never overwrite an entire DailyLog on write — always merge into existing

---

## Agent Detection Accuracy Targets

| Agent | Target Accuracy | Primary Signal |
|---|---|---|
| claude-code | 95% | .claude/ file watcher |
| cursor | 85% | vscode.env.appName |
| continue | 80% | Extension presence + block heuristic |
| copilot | 78% | Extension presence + incremental heuristic |
| false positives | <6% | User confirmation loop on low-confidence |
