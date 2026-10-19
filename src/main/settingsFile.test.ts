import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsFile } from './settingsFile'

describe('the settings file', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitdom-settings-'))
    path = join(dir, 'settings.json')
  })
  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty, and says so, when there is no file yet', () => {
    const file = new SettingsFile(path)
    file.load()
    expect(file.snapshot()).toEqual({ exists: false, values: {} })
  })

  it('reads the settings saved before', () => {
    writeFileSync(path, JSON.stringify({ 'gitdom.theme': 'nord', 'gitdom.splash': 'off' }))
    const file = new SettingsFile(path)
    file.load()
    expect(file.snapshot()).toEqual({
      exists: true,
      values: { 'gitdom.theme': 'nord', 'gitdom.splash': 'off' }
    })
  })

  it('keeps a file it cannot read as .bak and starts from scratch', () => {
    writeFileSync(path, '{"gitdom.theme": "nord"')
    const file = new SettingsFile(path)
    file.load()
    expect(file.snapshot().values).toEqual({})
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe('{"gitdom.theme": "nord"')
  })

  it('writes the changes a moment later, all at once', () => {
    vi.useFakeTimers()
    const file = new SettingsFile(path, 200)
    file.load()
    file.set('gitdom.theme', 'nord')
    file.set('gitdom.splash', 'off')
    file.remove('gitdom.splash')
    expect(existsSync(path)).toBe(false)
    vi.advanceTimersByTime(200)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ 'gitdom.theme': 'nord' })
    expect(existsSync(`${path}.tmp`)).toBe(false)
    expect(file.snapshot().exists).toBe(true)
  })

  it('writes pending changes right away when GitDom quits, and nothing when there are none', () => {
    const file = new SettingsFile(path, 60_000)
    file.load()
    file.flushPending()
    expect(existsSync(path)).toBe(false)
    file.set('gitdom.theme', 'nord')
    file.flushPending()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ 'gitdom.theme': 'nord' })
  })

  it('replaces every setting with imported ones', () => {
    writeFileSync(path, JSON.stringify({ 'gitdom.theme': 'nord', 'gitdom.splash': 'off' }))
    const file = new SettingsFile(path)
    file.load()
    file.replace({ 'gitdom.theme': 'light' })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ 'gitdom.theme': 'light' })
    expect(file.snapshot().values).toEqual({ 'gitdom.theme': 'light' })
  })
})
