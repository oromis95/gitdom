// Shows the questions of git and ssh (askpass.ts) in the window, and returns its answers.
import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../shared/api'
import { askpassKind, askpassSubject, type AskpassAnswer } from '../shared/askpass'
import { startAskpass, stopAskpass } from './askpass'
import script from '../../resources/askpass/askpass.sh?asset&asarUnpack'
import helper from '../../resources/askpass/askpass.js?asset&asarUnpack'

/** A question left unanswered this long is cancelled: the repository's other commands wait on it */
const ANSWER_WAIT = 5 * 60 * 1000

let nextId = 1
const waiting = new Map<number, (answer: AskpassAnswer) => void>()

function ask(prompt: string): Promise<AskpassAnswer> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!window || window.webContents.isDestroyed()) return Promise.resolve(null)
  const id = nextId++
  return new Promise((resolve) => {
    const done = (answer: AskpassAnswer): void => {
      clearTimeout(timer)
      window.webContents.off('destroyed', cancel)
      waiting.delete(id)
      resolve(answer)
    }
    const cancel = (): void => done(null)
    const timer = setTimeout(cancel, ANSWER_WAIT)
    waiting.set(id, done)
    window.webContents.once('destroyed', cancel)
    window.webContents.send(IPC.askpassRequest, {
      id,
      kind: askpassKind(prompt),
      prompt: prompt.trim(),
      subject: askpassSubject(prompt)
    })
  })
}

export function registerAskpass(): void {
  ipcMain.on(IPC.askpassReply, (_event, id: number, answer: AskpassAnswer) => {
    const valid =
      answer === null ||
      (typeof answer?.value === 'string' &&
        (answer.password === undefined || typeof answer.password === 'string'))
    waiting.get(id)?.(valid ? answer : null)
  })
  app.on('will-quit', () => void stopAskpass())
  startAskpass({ script, helper, node: process.execPath }, ask).catch((e) =>
    // Without the dialog, git fails as before when it needs to ask
    console.error('GitDom could not start the credential dialog:', e)
  )
}
