import { describe, expect, it } from 'vitest'
import { comboOf, displayCombo, shellKey, SHORTCUTS } from './keys'

const press = (
  key: string,
  code: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}
): string | null =>
  comboOf({ key, code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift })

describe('key combinations', () => {
  it('names letters by their position, with the modifiers in order', () => {
    expect(press('P', 'KeyP', { ctrl: true, shift: true })).toBe('Ctrl+Shift+P')
    expect(press('z', 'KeyZ', { ctrl: true })).toBe('Ctrl+Z')
    // A Cyrillic layout still gives Ctrl+F
    expect(press('а', 'KeyF', { ctrl: true })).toBe('Ctrl+F')
  })

  it('names the key left of 1 the same on every layout', () => {
    // Italian keyboards type a backslash there
    expect(press('\\', 'Backquote', { ctrl: true })).toBe('Ctrl+`')
  })

  it('names the other keys by what they type', () => {
    expect(press('+', 'BracketRight', { ctrl: true })).toBe('Ctrl+Plus')
    expect(press('-', 'Slash', { ctrl: true })).toBe('Ctrl+-')
    expect(press(',', 'Comma', { ctrl: true })).toBe('Ctrl+,')
    expect(press('ArrowDown', 'ArrowDown', { alt: true })).toBe('Alt+Down')
    expect(press(' ', 'Space')).toBe('Space')
    expect(press('F7', 'F7', { shift: true })).toBe('Shift+F7')
    expect(press('Enter', 'Enter', { ctrl: true })).toBe('Ctrl+Enter')
  })

  it('takes digits from their position with Ctrl, whatever Shift makes them type', () => {
    expect(press('0', 'Digit0', { ctrl: true })).toBe('Ctrl+0')
    expect(press('=', 'Digit0', { ctrl: true, shift: true })).toBe('Ctrl+Shift+0')
  })

  it('ignores modifiers pressed alone', () => {
    expect(press('Control', 'ControlLeft', { ctrl: true })).toBeNull()
    expect(press('Shift', 'ShiftLeft', { shift: true })).toBeNull()
  })

  it('shows combinations readably', () => {
    expect(displayCombo('Ctrl+Plus')).toBe('Ctrl++')
    expect(displayCombo('Esc')).toBe('Escape')
    expect(displayCombo('Ctrl+Shift+P')).toBe('Ctrl+Shift+P')
  })

  it('leaves plain Ctrl+letter to the shell', () => {
    expect(shellKey('Ctrl+P')).toBe(true)
    expect(shellKey('Ctrl+Shift+P')).toBe(false)
    expect(shellKey('Ctrl+`')).toBe(false)
  })
})

describe('default shortcuts', () => {
  it('give each key to one shortcut only', () => {
    const keys = SHORTCUTS.flatMap((s) => s.keys)
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([])
  })

  it('have unique ids', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
