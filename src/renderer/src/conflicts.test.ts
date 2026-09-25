import { describe, expect, it } from 'vitest'
import { buildOutput, conflictCount, parseConflicts } from './conflicts'

const text = [
  'top',
  '<<<<<<< HEAD',
  'mine',
  '=======',
  'theirs 1',
  'theirs 2',
  '>>>>>>> feature',
  'middle',
  '<<<<<<< HEAD',
  '||||||| base',
  'old',
  '=======',
  'new',
  '>>>>>>> feature',
  ''
].join('\n')

describe('parseConflicts', () => {
  it('splits common lines and conflicts, with diff3 base sections', () => {
    const file = parseConflicts(text)
    expect(conflictCount(file)).toBe(2)
    expect(file.segments[1]).toMatchObject({
      ours: ['mine'],
      theirs: ['theirs 1', 'theirs 2'],
      oursLabel: 'HEAD',
      theirsLabel: 'feature'
    })
    expect(file.segments[3]).toMatchObject({ ours: [], base: ['old'], theirs: ['new'] })
  })

  it('rebuilds the file from the choices, keeping unresolved markers', () => {
    const file = parseConflicts(text)
    expect(buildOutput(file, ['both', 'theirs'])).toBe(
      'top\nmine\ntheirs 1\ntheirs 2\nmiddle\nnew\n'
    )
    expect(buildOutput(file, [null, 'ours'])).toBe(
      'top\n<<<<<<< HEAD\nmine\n=======\ntheirs 1\ntheirs 2\n>>>>>>> feature\nmiddle\n'
    )
  })

  it('keeps CRLF line endings and treats unterminated markers as text', () => {
    const file = parseConflicts('a\r\n<<<<<<< HEAD\r\nb\r\n')
    expect(conflictCount(file)).toBe(0)
    expect(buildOutput(file, [])).toBe('a\r\n<<<<<<< HEAD\r\nb\r\n')
  })
})
