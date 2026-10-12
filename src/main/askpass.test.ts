import { connect } from 'net'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AskpassAnswer } from '../shared/askpass'
import { askpassEnv, startAskpass, stopAskpass } from './askpass'
import { runGit } from './git/exec'

// git asks the real askpass.sh, which runs askpass.js with this Node: the whole round trip
describe('askpass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitdom-askpass-'))
  const asked: string[] = []
  let reply: (prompt: string) => AskpassAnswer = () => null

  const fill = (options: { noPrompt?: boolean } = {}): Promise<string> =>
    runGit(dir, ['-c', 'credential.helper=', 'credential', 'fill'], {
      input: 'protocol=https\nhost=example.com\n\n',
      ...options
    })

  beforeAll(async () => {
    const resources = resolve(__dirname, '../../resources/askpass')
    await startAskpass(
      {
        script: join(resources, 'askpass.sh'),
        helper: join(resources, 'askpass.js'),
        node: process.execPath
      },
      async (prompt) => {
        asked.push(prompt)
        return reply(prompt)
      }
    )
  })

  beforeEach(() => {
    asked.length = 0
  })

  afterAll(async () => {
    await stopAskpass()
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers git with the dialog, asking once for username and password', async () => {
    reply = () => ({ value: 'me', password: 's3cret' })
    const out = await fill()
    expect(out).toContain('username=me\n')
    expect(out).toContain('password=s3cret\n')
    expect(asked).toEqual(["Username for 'https://example.com': "])
  })

  it('asks for the password alone when git only needs that', async () => {
    reply = (prompt) => ({ value: prompt.startsWith('Username') ? 'me' : 'other' })
    const out = await fill()
    expect(out).toContain('password=other\n')
    expect(asked).toHaveLength(2)
    expect(asked[1]).toBe("Password for 'https://me@example.com': ")
  })

  it('makes git fail when the dialog is cancelled', async () => {
    reply = () => null
    await expect(fill()).rejects.toThrow()
    expect(asked).toHaveLength(1)
  })

  it('fails without asking when nobody is waiting', async () => {
    reply = () => ({ value: 'me', password: 'x' })
    await expect(fill({ noPrompt: true })).rejects.toThrow()
    expect(asked).toEqual([])
  })

  it('refuses requests without the token', async () => {
    const answer = await new Promise<string>((done) => {
      const socket = connect(askpassEnv().GITDOM_ASKPASS_PIPE)
      let text = ''
      socket.on('connect', () =>
        socket.write(JSON.stringify({ token: 'nope', prompt: 'x' }) + '\n')
      )
      socket.on('data', (chunk) => (text += chunk))
      socket.on('close', () => done(text))
      socket.on('error', () => done(text))
    })
    expect(answer).toBe('')
    expect(asked).toEqual([])
  })
})
