// Syntax highlighting of source lines, shared by the diff and blame views.
import hljs from 'highlight.js/lib/common'

/** Beyond this, lines are shown as plain text: highlighting would make large files sluggish. */
const HIGHLIGHT_LIMIT = 5000

const FILE_NAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  jenkinsfile: 'groovy'
}

function languageOf(path: string): string | undefined {
  const name = path.split('/').pop()!.toLowerCase()
  if (FILE_NAME_LANGUAGES[name]) return FILE_NAME_LANGUAGES[name]
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return ext && hljs.getLanguage(ext) ? ext : undefined
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * HTML for each line, highlighted after the file's language.
 * Lines are highlighted separately: constructs spanning lines (block comments) lose their colour, a fair trade.
 */
export function highlightLines(path: string, lines: string[]): string[] {
  const language = languageOf(path)
  return lines.map((text, i) =>
    language && i < HIGHLIGHT_LIMIT
      ? hljs.highlight(text, { language, ignoreIllegals: true }).value
      : escapeHtml(text)
  )
}
