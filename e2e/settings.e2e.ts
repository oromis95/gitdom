import { readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { version } from '../package.json'
import { cleanUp, launch, makeRepo, palette, scratch } from './helpers'

const settingsOf = (profile: string): Record<string, string> =>
  JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))

describe('Settings', () => {
  let dir: string
  let repo: string

  beforeAll(() => {
    dir = scratch('repos')
    repo = makeRepo(dir)
  })

  afterAll(() => cleanUp(dir))

  it('keeps the settings in a file, from one start to the next', async () => {
    const profile = scratch('profile')
    try {
      const first = await launch([repo], { profile })
      await palette(first.win, 'Theme: Light')
      await first.win.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      expect(first.errors).toEqual([])
      await first.close()
      expect(settingsOf(profile)['gitdom.theme']).toBe('light')

      const second = await launch([repo], { profile })
      await expect(second.win.evaluate(() => document.documentElement.dataset.theme)).resolves.toBe(
        'light'
      )
      expect(second.errors).toEqual([])
      await second.close()
    } finally {
      cleanUp(profile)
    }
  })

  it('brings the settings of an older GitDom over from localStorage, once', async () => {
    const profile = scratch('profile')
    try {
      // A profile of GitDom 1.10: everything in localStorage and no settings file
      const old = await launch([repo], { profile })
      await old.win.evaluate(
        ([v, tabs]) => {
          localStorage.setItem(
            'gitdom.settings',
            JSON.stringify({ showTips: false, checkUpdates: false, autoFetchMinutes: 0 })
          )
          localStorage.setItem('gitdom.splash', 'off')
          localStorage.setItem('gitdom.lastVersion', v)
          localStorage.setItem('gitdom.theme', 'light')
          localStorage.setItem('gitdom.tabs', JSON.stringify({ paths: tabs, active: 0 }))
        },
        [version, [repo]] as const
      )
      await old.close()
      rmSync(join(profile, 'settings.json'))

      const upgraded = await launch([repo], { profile, seed: false })
      await expect(
        upgraded.win.evaluate(() => document.documentElement.dataset.theme)
      ).resolves.toBe('light')
      await upgraded.close()
      expect(settingsOf(profile)).toMatchObject({
        'gitdom.theme': 'light',
        'gitdom.splash': 'off',
        'gitdom.tabs': JSON.stringify({ paths: [repo], active: 0 })
      })
    } finally {
      cleanUp(profile)
    }
  })

  it('exports the settings to a file and imports them back', async () => {
    const exported = join(dir, 'exported.json')
    const gitdom = await launch([repo])
    try {
      await gitdom.app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
      }, exported)
      await palette(gitdom.win, 'Export settings to a file')
      await gitdom.win.waitForSelector('.toast:has-text("Settings exported")')
      const saved = JSON.parse(readFileSync(exported, 'utf8'))
      expect(saved['gitdom.theme']).toBe('dark')

      writeFileSync(exported, JSON.stringify({ ...saved, 'gitdom.theme': 'light' }))
      await palette(gitdom.win, 'Import settings from a file')
      // The window reloads: for a moment there is no document element to read
      await gitdom.win.waitForFunction(() => document.documentElement?.dataset.theme === 'light')
      await gitdom.win.waitForSelector('.graph-row')
      expect(gitdom.errors).toEqual([])
    } finally {
      await gitdom.close()
    }
  })
})
