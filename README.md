# Rabbit Hole

Automatic coding-activity tracking for VS Code, with an in-editor dashboard.

Everything is local. No account, no backend, no telemetry — your data lives in VS Code's
storage on your machine and never leaves it.

---

## What it does

Rabbit Hole runs quietly in the background and records what you actually worked on:

- **Active time, not elapsed time.** Idle gaps are excluded. Step away for five minutes and
  the clock pauses; come back within an hour and the same session resumes.
- **Lines added and deleted**, per file and per language.
- **Language breakdown**, by time and by lines.
- **Per-project history**, detected automatically from your git remote (or the folder, for
  non-git projects). Projects are tracked separately and can be viewed together.
- **Daily streaks** against a target you choose.

### It sees your AI agent's edits

Most time trackers only observe the editor, so work done by a coding agent is invisible to
them. Rabbit Hole also watches the workspace on disk, so edits made by Claude Code, Aider,
or any CLI tool are counted — including to files you never opened.

Those edits are measured the same way as typing: a multiset diff over per-line hashes, so a
200-line in-place rewrite counts as 200 changed lines rather than a net zero. Branch
switches, merges and rebases are detected and excluded, so checkout churn is not recorded
as work.

---

## The dashboard

Open it from the status bar, or run **Rabbit Hole: Open Dashboard** from the command
palette.

| Panel | Shows |
|-------|-------|
| **Overview** | Active time, lines added/deleted, streak, language split |
| **Activity** | Contribution heatmap, lines per day, session history |
| **Code** | Most-active files across the selected range |
| **Projects** | Per-project totals, streaks and individual targets |
| **Settings** | Daily target, idle threshold, and your data |

Filter by Today, Yesterday, This Week, This Month, or any custom day or range from the
calendar. Export any view as JPG, CSV or JSON.

There is also a compact panel in the Activity Bar for a glance at today without opening the
full dashboard.

---

## Your data

Everything is stored locally by VS Code. The **Settings → Your data** section gives you
full control:

- **Back up everything** or **back up some projects** — a complete, restorable snapshot
  written to a folder you can open from the dashboard.
- **Restore everything** or **restore some projects** — bring history back after a mistaken
  delete, or move a project's history to another machine. Restoring specific projects
  leaves every other project untouched.
- **Clear a project's history** or **clear everything** — both gated by typing the exact
  name to confirm, and both write a backup first.

A JSON mirror of your data is also maintained on disk, so you can read it with your own
tools — or with the CLI below.

---

## Companion CLI

[**rabbithole-cli**](https://github.com/platinumfalcon98/rabbithole-cli) puts the same stats
in your terminal, for when you don't want to open a dashboard to answer "how long have I
been at this?".

```sh
brew install platinumfalcon98/tap/rabbithole      # macOS, Linux
scoop bucket add platinumfalcon98 https://github.com/platinumfalcon98/scoop-bucket
scoop install rabbithole                           # Windows
```

Prebuilt binaries for macOS, Linux and Windows on amd64 and arm64 are on the
[releases page](https://github.com/platinumfalcon98/rabbithole-cli/releases), along with
install scripts and a `go install` route.

| Command | Shows |
|---------|-------|
| `rabbithole today` | Today's active time, languages, projects, sessions |
| `rabbithole streak` | Current streak and progress toward your target |
| `rabbithole week [n]` | The last 7 days as a bar chart, or the last `n` |
| `rabbithole files [n]` | Files touched over that range, grouped by project |
| `rabbithole projects` | Tracked projects and their recent activity |
| `rabbithole doctor` | Check the data source for format drift |

`today` and `week` take `--project` to narrow to one project, and every command takes
`--json` for scripting:

```sh
rabbithole streak --json | jq -e '.targetMet' >/dev/null && echo "done for today"
```

The CLI **reads only** — it never writes to your data and never touches the network. It
reads the JSON mirror this extension publishes, falling back to VS Code's storage directly
for history that predates the mirror. It reports on what the extension has recorded; it
does not track anything itself, so the extension is what you need installed.

---

## Settings

| Setting | Default | What it does |
|---------|---------|--------------|
| `rabbithole.dailyTargetMinutes` | 20 | Daily active-coding target. Days that reach it extend your streak. |
| `rabbithole.idleThresholdMinutes` | 5 | Minutes of inactivity before the active timer pauses. |

Individual projects can override the daily target from the Projects tab; without an
override they inherit the global one.

Each day is judged against the target that was set **at the time**, so raising your target
later never erases a streak you already earned.

---

## Known limitations

- **In-editor AI suggestions are counted as your own typing.** Accepting a Copilot or
  Cursor completion looks identical to typing it — VS Code's change events carry no
  provenance. Attributing those is not currently possible and is not attempted.
- **Multi-root workspaces can split attribution.** With several folders in one window, an
  agent editing project B while you are focused on project A records B's lines against B
  but A's time against A.
- **External line counts are approximate**, by roughly 0.3% on large files, because they are
  computed from 32-bit line hashes.
- **Time is measured per window.** A file changed while VS Code is closed is not counted,
  and the first edit to a given file after a restart establishes a baseline rather than
  being recorded.

---

## Requirements

VS Code 1.85 or newer. No other dependencies.

---

## Contributing

```bash
npm install
npm run build      # extension + webview
npm test           # 144 assertions across 5 suites
npm run typecheck  # src and tests
```

Press <kbd>F5</kbd> to launch an Extension Development Host.

---

## License

MIT — see [LICENSE](LICENSE).
