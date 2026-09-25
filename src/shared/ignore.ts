// .gitignore patterns for files picked in the UI (COMMIT-11).

export type IgnoreKind = 'file' | 'extension' | 'folder'

/** Escapes the characters .gitignore reads as wildcards, and a trailing space it would drop. */
function escapePattern(text: string): string {
  return text.replace(/[\\*?[]/g, '\\$&').replace(/ $/, '\\ ')
}

/** Extension of a file name, without the dot; null when it has none (or is a dotfile like .env). */
export function extensionOf(path: string): string | null {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : null
}

/** Folder of a path relative to the repository root, null at the root. */
export function folderOf(path: string): string | null {
  const slash = path.lastIndexOf('/')
  return slash > 0 ? path.slice(0, slash) : null
}

/**
 * Pattern for the root .gitignore matching exactly this file, every file with its extension, or
 * the folder containing it. Paths use forward slashes, as git reports them.
 */
export function ignorePattern(path: string, kind: IgnoreKind): string {
  if (kind === 'extension') {
    const extension = extensionOf(path)
    if (!extension) throw new Error(`${path} has no extension`)
    return `*.${escapePattern(extension)}`
  }
  if (kind === 'folder') {
    const folder = folderOf(path)
    if (!folder) throw new Error(`${path} is not in a folder`)
    return `/${escapePattern(folder)}/`
  }
  // A leading slash anchors the pattern to the root, and keeps a leading # or ! literal
  return `/${escapePattern(path)}`
}
