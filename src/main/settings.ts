// Settings the main process needs, owned by the renderer and sent over IPC (see ToolSettings).
import type { ToolSettings } from '../shared/api'

let current: ToolSettings = { gitPath: '', editor: '', mergeTool: '' }

export const toolSettings = (): ToolSettings => current

export function setToolSettings(settings: ToolSettings): void {
  current = {
    gitPath: String(settings.gitPath ?? '').trim(),
    editor: String(settings.editor ?? '').trim(),
    mergeTool: String(settings.mergeTool ?? '').trim()
  }
}

/** The git executable to run: the configured one, or git from the PATH. */
export const gitBinary = (): string => current.gitPath || 'git'
