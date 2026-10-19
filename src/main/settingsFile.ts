// The settings file in userData. The renderer keeps a copy in memory and sends each change here;
// changes are written a moment later, all at once, and right away when GitDom quits.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { parseStoredValues, type StoredSettings, type StoredValues } from '../shared/storedSettings'

export class SettingsFile {
  private values: StoredValues = {}
  private exists = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    readonly path: string,
    private readonly delay = 200
  ) {}

  /** Reads the file; one that can't be read is kept as .bak and GitDom starts from scratch. */
  load(): void {
    this.values = {}
    this.exists = existsSync(this.path)
    if (!this.exists) return
    const values = parseStoredValues(readFileSync(this.path, 'utf8'))
    if (values) this.values = values
    else copyFileSync(this.path, `${this.path}.bak`)
  }

  snapshot(): StoredSettings {
    return { exists: this.exists, values: { ...this.values } }
  }

  set(key: string, value: string): void {
    this.values[key] = value
    this.schedule()
  }

  remove(key: string): void {
    delete this.values[key]
    this.schedule()
  }

  /** Every setting at once, from an imported file. */
  replace(values: StoredValues): void {
    this.values = { ...values }
    this.flush()
  }

  /** Writes now: to a temporary file first, so a crash can't leave half. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const sorted = Object.fromEntries(
      Object.entries(this.values).sort(([a], [b]) => (a < b ? -1 : 1))
    )
    writeFileSync(`${this.path}.tmp`, `${JSON.stringify(sorted, null, 2)}\n`)
    renameSync(`${this.path}.tmp`, this.path)
    this.exists = true
  }

  /** Writes pending changes, if any. */
  flushPending(): void {
    if (this.timer) this.flush()
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delay)
  }
}
