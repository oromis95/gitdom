import { execSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { shellQuote } from './shellQuote'

describe('shellQuote', () => {
  it('quotes for sh with single quotes', () => {
    expect(shellQuote('a b.txt', 'linux')).toBe(`'a b.txt'`)
    expect(shellQuote(`it's $(x).txt`, 'darwin')).toBe(`'it'\\''s $(x).txt'`)
  })

  it('quotes for cmd, breaking %NAME%', () => {
    expect(shellQuote('C:\\repo\\a b.txt', 'win32')).toBe('"C:\\repo\\a b.txt"')
    expect(shellQuote('%PATH%.txt', 'win32')).toBe('""^%"PATH"^%".txt"')
  })

  // The real shell of this system gets the name back unchanged, and runs nothing in it
  describe('through the shell', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitdom-quote-'))
    const script = join(dir, 'argv.js')
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    const names =
      process.platform === 'win32'
        ? ['a b.txt', '%PATH%.txt', '%OS% & echo hacked.txt', "it's (1).txt", 'x^y!z.txt']
        : ['a b.txt', '$(echo hacked).txt', '`echo hacked`.txt', "it's $HOME.txt", 'a"b\\c.txt']

    it.each(names)('%s', (name) => {
      const out = execSync(`"${process.execPath}" ${shellQuote(script)} ${shellQuote(name)}`, {
        encoding: 'utf8'
      })
      expect(JSON.parse(out)).toEqual([name])
    })
  })
})
