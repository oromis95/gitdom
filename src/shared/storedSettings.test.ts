import { describe, expect, it } from 'vitest'
import { legacyEntries, parseStoredValues } from './storedSettings'

describe('parseStoredValues', () => {
  it('reads an object of gitdom.* strings', () => {
    const text = JSON.stringify({ 'gitdom.theme': 'nord', 'gitdom.tabs': '{"paths":[]}' })
    expect(parseStoredValues(text)).toEqual({
      'gitdom.theme': 'nord',
      'gitdom.tabs': '{"paths":[]}'
    })
    expect(parseStoredValues('{}')).toEqual({})
  })

  it("refuses anything that isn't GitDom's settings", () => {
    expect(parseStoredValues('not json')).toBeNull()
    expect(parseStoredValues('null')).toBeNull()
    expect(parseStoredValues('["gitdom.theme"]')).toBeNull()
    expect(parseStoredValues('{"theme": "nord"}')).toBeNull()
    expect(parseStoredValues('{"gitdom.zoom": 1.2}')).toBeNull()
  })
})

describe('legacyEntries', () => {
  it("takes GitDom's entries from localStorage and leaves the others", () => {
    const entries: [string, string][] = [
      ['gitdom.theme', 'nord'],
      ['other', 'x'],
      ['gitdom.recent', '["C:/repo"]']
    ]
    const storage = {
      length: entries.length,
      key: (i: number) => entries[i]?.[0] ?? null,
      getItem: (key: string) => entries.find(([k]) => k === key)?.[1] ?? null
    }
    expect(legacyEntries(storage)).toEqual({
      'gitdom.theme': 'nord',
      'gitdom.recent': '["C:/repo"]'
    })
  })
})
