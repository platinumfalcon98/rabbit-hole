// The README.md the hook and agent scenes keep focused (rabbithole-cli's own,
// shortened). Colours follow VS Code's Dark Modern markdown tokens.
import type { EditorLine } from "./VsCodeFrame"

const H1 = "#569cd6", TEXT = "#cccccc", CODE = "#ce9178", DIM = "#6a9955"
export const README: EditorLine[] = [
  { text: "# rabbithole-cli", color: H1 },
  { text: "" },
  { text: "Your Rabbit Hole coding time, from the terminal.", color: TEXT },
  { text: "Reads the extension's local mirror. Offline. No account.", color: TEXT },
  { text: "" },
  { text: "## Install", color: H1 },
  { text: "" },
  { text: "    brew install rabbithole/tap/rabbithole", color: CODE },
  { text: "" },
  { text: "## Usage", color: H1 },
  { text: "" },
  { text: "    rabbithole today", color: CODE },
  { text: "    rabbithole week 4", color: CODE },
  { text: "    rabbithole streak --json", color: CODE },
  { text: "" },
  { text: "<!-- TODO: document --project -->", color: DIM },
]
