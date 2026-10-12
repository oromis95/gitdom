import { describe, expect, it } from 'vitest'
import { askpassKind, askpassSubject, isAuthFailure, passwordPromptFor } from './askpass'

describe('askpass questions', () => {
  const host = [
    "The authenticity of host 'github.com (140.82.121.4)' can't be established.",
    'ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.',
    'Are you sure you want to continue connecting (yes/no/[fingerprint])? '
  ].join('\n')

  it.each([
    ["Username for 'https://github.com': ", 'username', 'https://github.com'],
    ["Password for 'https://me@github.com': ", 'password', 'https://github.com'],
    ["Enter passphrase for key '/c/Users/me/.ssh/id_ed25519': ", 'passphrase', 'id_ed25519'],
    [host, 'hostKey', 'github.com'],
    ['Token: ', 'password', '']
  ])('%s', (prompt, kind, subject) => {
    expect(askpassKind(prompt)).toBe(kind)
    expect(askpassSubject(prompt)).toBe(subject)
  })

  it('knows the password question that follows a username', () => {
    expect(passwordPromptFor("Username for 'https://github.com': ", 'me')).toBe(
      "Password for 'https://me@github.com': "
    )
    expect(passwordPromptFor('Username: ', 'me')).toBeNull()
  })

  it('recognizes failures for want of credentials', () => {
    expect(
      isAuthFailure(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
      )
    ).toBe(true)
    expect(isAuthFailure('git@github.com: Permission denied (publickey).')).toBe(true)
    expect(isAuthFailure('Host key verification failed.')).toBe(true)
    expect(isAuthFailure("remote: Repository not found.\nfatal: repository 'x' not found")).toBe(
      false
    )
  })
})
