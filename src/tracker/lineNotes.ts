// Day-scoped notes about line counting: git unavailable in a folder, a capture
// that hit its cap, a capped catch-up. The tracker writes them; the dashboard's
// settings message carries them to the Settings console. No pop-ups.

export class LineNotes {
  private day = ""
  private notes: string[] = []
  private listeners: (() => void)[] = []

  add(day: string, text: string): void {
    if (day !== this.day) { this.day = day; this.notes = [] }
    if (this.notes.includes(text)) return
    this.notes.push(text)
    for (const fn of [...this.listeners]) fn()
  }

  current(day: string): string[] {
    return day === this.day ? [...this.notes] : []
  }

  onChange(fn: () => void): { dispose(): void } {
    this.listeners.push(fn)
    return { dispose: () => { this.listeners = this.listeners.filter(f => f !== fn) } }
  }
}

export const lineNotes = new LineNotes()
