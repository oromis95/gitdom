// Accounts on the services, one per host, in their own file next to the settings: never in
// settings.json, which Export Settings copies. Tokens are encrypted with the system's keychain
// (safeStorage); Git Credential Manager's aren't copied at all, they're asked for again each session.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import type { ForgeAccount, ForgeKind, ForgeUser, TokenSource } from '../../shared/forge'

export interface Cipher {
  available(): boolean
  encrypt(text: string): string
  decrypt(text: string): string
}

export interface StoredAccount {
  host: string
  kind: ForgeKind
  user: ForgeUser
  source: TokenSource
  /** Encrypted; absent for Git Credential Manager's tokens */
  token?: string
  /** Encrypted; device logins whose tokens expire (GitLab) renew them with it */
  refresh?: string
  /** Unix milliseconds the token stops working, when it does */
  expiresAt?: number
  /** Encrypted; sent with the token as username and password (a Bitbucket account's email) */
  username?: string
  /** Git Credential Manager's username goes with its token (Bitbucket app passwords) */
  gcmUser?: boolean
}

/** A token, with what renews it when it expires. */
export interface Secret {
  token: string
  /** Sent with the token as username and password, where the service wants that */
  username?: string
  refresh?: string
  expiresAt?: number
}

const isAccount = (a: unknown): a is StoredAccount => {
  const x = a as StoredAccount
  return (
    !!x &&
    typeof x.host === 'string' &&
    typeof x.kind === 'string' &&
    !!x.user &&
    typeof x.source === 'string'
  )
}

export class AccountStore {
  private accounts: StoredAccount[] = []
  /** Tokens held only while GitDom runs: Git Credential Manager's, and all when nothing can encrypt */
  private memory = new Map<string, Secret>()
  /** Accounts that couldn't be saved, because nothing on the system can encrypt their token */
  private session = new Map<string, StoredAccount>()

  constructor(
    readonly path: string,
    private readonly cipher: Cipher
  ) {}

  load(): void {
    this.accounts = []
    if (!existsSync(this.path)) return
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as { accounts?: unknown[] }
      this.accounts = (data.accounts ?? []).filter(isAccount)
    } catch {
      // Unreadable: the accounts are connected again
    }
  }

  list(): ForgeAccount[] {
    const hosts = new Set([...this.accounts.map((a) => a.host), ...this.memory.keys()])
    return [...hosts].flatMap((host) => {
      const a = this.find(host)
      return a ? [{ host: a.host, kind: a.kind, user: a.user, source: a.source }] : []
    })
  }

  find(host: string): StoredAccount | undefined {
    return this.accounts.find((a) => a.host === host) ?? this.session.get(host)
  }

  /** The account's token, decrypted; null when there is none to read (GCM's are asked for again). */
  secret(host: string): Secret | null {
    const held = this.memory.get(host)
    if (held) return held
    const account = this.accounts.find((a) => a.host === host)
    if (!account?.token) return null
    try {
      const secret: Secret = {
        token: this.cipher.decrypt(account.token),
        username: account.username ? this.cipher.decrypt(account.username) : undefined,
        refresh: account.refresh ? this.cipher.decrypt(account.refresh) : undefined,
        expiresAt: account.expiresAt
      }
      this.memory.set(host, secret)
      return secret
    } catch {
      // Encrypted by another user or system: unusable
      return null
    }
  }

  /** Adds or replaces the account of a host. Git Credential Manager's token is only kept in memory. */
  save(
    account: Omit<StoredAccount, 'token' | 'refresh' | 'expiresAt' | 'username'>,
    secret: Secret
  ): void {
    this.memory.set(account.host, secret)
    const { host, kind, user, source, gcmUser } = account
    const stored: StoredAccount = { host, kind, user, source, ...(gcmUser ? { gcmUser } : {}) }
    if (account.source !== 'gcm') {
      if (!this.cipher.available()) {
        // Never in clear on disk (NFR-06): the account lasts until GitDom closes
        this.session.set(account.host, stored)
        this.accounts = this.accounts.filter((a) => a.host !== account.host)
        this.write()
        return
      }
      stored.token = this.cipher.encrypt(secret.token)
      if (secret.username) stored.username = this.cipher.encrypt(secret.username)
      if (secret.refresh) stored.refresh = this.cipher.encrypt(secret.refresh)
      if (secret.expiresAt) stored.expiresAt = secret.expiresAt
    }
    this.session.delete(account.host)
    this.accounts = [...this.accounts.filter((a) => a.host !== account.host), stored]
    this.write()
  }

  /** Forgets the token held in memory, e.g. once the service refused it. */
  drop(host: string): void {
    this.memory.delete(host)
  }

  remove(host: string): void {
    this.memory.delete(host)
    this.session.delete(host)
    this.accounts = this.accounts.filter((a) => a.host !== host)
    this.write()
  }

  /** Whether the system can encrypt tokens; without it they last until GitDom closes. */
  canSave(): boolean {
    return this.cipher.available()
  }

  private write(): void {
    writeFileSync(`${this.path}.tmp`, `${JSON.stringify({ accounts: this.accounts }, null, 2)}\n`)
    renameSync(`${this.path}.tmp`, this.path)
  }
}
