// Answers a question of git (GIT_ASKPASS) or ssh (SSH_ASKPASS): askpass.sh runs it with GitDom's own
// executable as Node. It hands the question to GitDom over a local pipe, GitDom shows it in a
// dialog, and the answer is printed for git. Exits with 1 when the dialog is cancelled.
'use strict'
const net = require('net')

const pipe = process.env.GITDOM_ASKPASS_PIPE
const token = process.env.GITDOM_ASKPASS_TOKEN
const prompt = process.argv.slice(2).join(' ')

if (!pipe || !token) process.exit(1)

const socket = net.connect(pipe)
let reply = ''
socket.setEncoding('utf8')
socket.on('connect', () => socket.write(JSON.stringify({ token, prompt }) + '\n'))
socket.on('data', (chunk) => (reply += chunk))
socket.on('error', () => process.exit(1))
socket.on('close', () => {
  let answer = null
  try {
    answer = JSON.parse(reply)
  } catch {
    // GitDom closed without answering
  }
  if (typeof answer !== 'string') process.exit(1)
  process.stdout.write(answer + '\n')
  process.exit(0)
})
