import { describe, expect, it } from 'vitest'
import { buildFolders, type FolderNode } from './folderTree'

/** The tree as text: folders end with a slash, children indented. */
function outline(node: FolderNode<{ path: string }>, depth = 0): string[] {
  const pad = '  '.repeat(depth)
  return [
    ...[...node.folders.values()].flatMap((f) => [
      `${pad}${f.name}/ (${f.path})`,
      ...outline(f, depth + 1)
    ]),
    ...node.files.map((f) => `${pad}${f.path.split('/').pop()}`)
  ]
}

const files = (...paths: string[]): { path: string }[] => paths.map((path) => ({ path }))

describe('buildFolders', () => {
  it('shows a folder holding only one folder as one with it', () => {
    const tree = buildFolders(
      files(
        'src/main/java/com/bank/core/api/Controller.java',
        'src/main/java/com/bank/core/dto/Request.java',
        'src/main/java/com/bank/core/dto/mapper/RequestMapper.java',
        'pom.xml'
      )
    )
    expect(outline(tree)).toEqual([
      'src/main/java/com/bank/core/ (src/main/java/com/bank/core)',
      '  api/ (src/main/java/com/bank/core/api)',
      '    Controller.java',
      '  dto/ (src/main/java/com/bank/core/dto)',
      '    mapper/ (src/main/java/com/bank/core/dto/mapper)',
      '      RequestMapper.java',
      '    Request.java',
      'pom.xml'
    ])
  })

  it('keeps a folder with files of its own apart from the folder inside it', () => {
    const tree = buildFolders(files('docs/README.md', 'docs/guide/start.md'))
    expect(outline(tree)).toEqual([
      'docs/ (docs)',
      '  guide/ (docs/guide)',
      '    start.md',
      '  README.md'
    ])
  })
})
