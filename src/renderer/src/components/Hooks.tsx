// Repository → Hooks: the scripts git runs at moments of its work, to see, write, turn off and on,
// try and delete. Turned off means set aside with a .disabled suffix, so nothing is lost.
import { useEffect, useState } from 'react'
import { FolderOpen, Play } from 'lucide-react'
import type { HookInfo, HookRun, HooksInfo } from '../../../shared/api'
import { confirm, notify, useUi, type HooksSession } from '../ui'
import { run as runOp, runValue, showInFolder } from '../actions'

const STATES: Record<HookInfo['state'], string> = {
  active: 'on',
  disabled: 'off',
  sample: 'example',
  none: ''
}

/** What a new hook starts from, when git left no sample for it */
const EMPTY_SCRIPT = '#!/bin/sh\n# Exit with a code other than 0 to stop git\n\nexit 0\n'

const hasScript = (hook: HookInfo): boolean => hook.state === 'active' || hook.state === 'disabled'

function Dialog({ session }: { session: HooksSession }): React.JSX.Element {
  const { repo } = session
  const close = (): void => useUi.setState({ hooks: null })
  const [loads, setLoads] = useState(0)
  const [info, setInfo] = useState<HooksInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  // The script as read, and as edited
  const [script, setScript] = useState<{ name: string; saved: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<{ name: string; result: HookRun } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.querySelectorAll('.modal, .menu-backdrop').length === 1)
        close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.op(repo, 'hooks').then((result) => {
      if (cancelled) return
      if (result.ok) setInfo(result.value)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [repo, loads])

  // The first hook with a script, else pre-commit
  const name = chosen ?? info?.hooks.find(hasScript)?.name ?? info?.hooks[0]?.name ?? null
  const hook = info?.hooks.find((h) => h.name === name) ?? null

  useEffect(() => {
    if (!name) return
    let cancelled = false
    void window.api.op(repo, 'readHook', name).then((result) => {
      if (cancelled || !result.ok) return
      const text = result.value || EMPTY_SCRIPT
      setScript({ name, saved: result.value, text })
    })
    return () => {
      cancelled = true
    }
    // Again after a change: deleting leaves the example, turning off keeps the script
  }, [repo, name, loads])

  const shown = script?.name === name ? script : null
  const edited = !!shown && hook && (shown.text !== shown.saved || !hasScript(hook))

  const choose = async (next: string): Promise<void> => {
    if (next === name) return
    if (
      edited &&
      hook &&
      hasScript(hook) &&
      !(await confirm('Unsaved changes', `Leave ${name} without saving?`, 'Leave', true))
    )
      return
    setChosen(next)
  }

  const act = async (work: () => Promise<boolean>, done?: string): Promise<boolean> => {
    setBusy(true)
    const ok = await work()
    setBusy(false)
    if (!ok) return false
    if (done) notify('success', done)
    setLoads((n) => n + 1)
    return true
  }

  const save = async (): Promise<void> => {
    if (!shown || !hook) return
    const text = shown.text
    const created = !hasScript(hook)
    if (
      await act(
        () => runOp(repo, 'saveHook', hook.name, text),
        created ? `${hook.name} created` : `${hook.name} saved`
      )
    )
      setScript({ name: hook.name, saved: text.replace(/\r\n/g, '\n'), text })
  }

  const toggle = (): Promise<boolean> | undefined =>
    hook
      ? act(
          () => runOp(repo, 'setHookEnabled', hook.name, hook.state === 'disabled'),
          hook.state === 'disabled' ? `${hook.name} turned on` : `${hook.name} turned off`
        )
      : undefined

  const remove = async (): Promise<void> => {
    if (!hook) return
    const ok = await confirm(
      'Delete hook',
      `Delete the ${hook.name} script? To keep it without git running it, turn it off instead.`,
      'Delete',
      true
    )
    if (ok && (await act(() => runOp(repo, 'deleteHook', hook.name), `${hook.name} deleted`)))
      setScript(null)
  }

  const tryIt = async (): Promise<void> => {
    if (!hook) return
    setBusy(true)
    setRun(null)
    const result = await runValue(repo, 'runHook', hook.name)
    setBusy(false)
    if (result) setRun({ name: hook.name, result })
  }

  const relativeDir =
    info &&
    info.dir
      .replace(/\\/g, '/')
      .toLowerCase()
      .startsWith(repo.replace(/\\/g, '/').toLowerCase() + '/')
      ? info.dir.slice(repo.length + 1)
      : null
  const result = run?.name === name ? run.result : null

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : close}>
      <div className="modal hooks" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Hooks</div>
        {error ? (
          <div className="hooks-note">{error}</div>
        ) : !info ? (
          <div className="hooks-note">Reading the hooks…</div>
        ) : (
          <>
            <div className="hooks-where">
              <span>
                Scripts git runs at moments of its work, from{' '}
                <span className="mono">{info.dir}</span>
              </span>
              {relativeDir && (
                <button
                  className="btn btn-small"
                  title="Show the folder"
                  onClick={() => showInFolder(repo, relativeDir)}
                >
                  <FolderOpen size={13} />
                </button>
              )}
            </div>
            {info.hooksPath && (
              <div className="hooks-managed">
                {info.manager
                  ? `${info.manager} writes these hooks (core.hooksPath = ${info.hooksPath}): changes made here may be overwritten the next time it installs them.`
                  : `This repository reads its hooks from ${info.hooksPath} (core.hooksPath): they may be part of the project, shared with everyone.`}
              </div>
            )}
            {!info.hooksPath && info.manager && (
              <div className="hooks-managed">
                {info.manager} installed these hooks: changes made here may be overwritten.
              </div>
            )}
            <div className="hooks-body">
              <div className="hooks-list" role="listbox" aria-label="Hooks">
                {info.hooks.map((h) => (
                  <button
                    key={h.name}
                    role="option"
                    aria-selected={h.name === name}
                    className={`hooks-row${h.name === name ? ' active' : ''}${hasScript(h) ? '' : ' empty'}`}
                    title={h.description}
                    onClick={() => void choose(h.name)}
                  >
                    <span className="mono">{h.name}</span>
                    {STATES[h.state] && (
                      <span className={`hooks-state ${h.state}`}>{STATES[h.state]}</span>
                    )}
                  </button>
                ))}
              </div>
              {hook && (
                <div className="hooks-editor">
                  <div className="hooks-head">
                    <span className="mono hooks-name">{hook.name}</span>
                    <span className="hooks-description">{hook.description}</span>
                  </div>
                  <div className="hooks-status">
                    {hook.state === 'active'
                      ? 'On: git runs it.'
                      : hook.state === 'disabled'
                        ? 'Off: kept as ' + hook.name + '.disabled, git ignores it.'
                        : hook.state === 'sample'
                          ? 'Not set: below is the example git ships, save it to turn it on.'
                          : 'Not set: write a script and save it to turn it on.'}
                    {hook.skippable && ' "Skip hooks" in the commit box skips it.'}
                  </div>
                  <textarea
                    className="hooks-script mono"
                    spellCheck={false}
                    aria-label={`Script of ${hook.name}`}
                    value={shown?.text ?? ''}
                    disabled={!shown}
                    onChange={(e) => shown && setScript({ ...shown, text: e.target.value })}
                  />
                  {result && (
                    <div className={`hooks-run ${result.ok ? 'ok' : 'failed'}`}>
                      <div>
                        {result.ok
                          ? 'It went through: git would carry on.'
                          : 'It failed: git would stop here.'}
                      </div>
                      {result.output && <pre className="mono">{result.output}</pre>}
                    </div>
                  )}
                  <div className="hooks-actions">
                    <button
                      className="btn btn-primary"
                      disabled={busy || !edited}
                      onClick={() => void save()}
                    >
                      {hasScript(hook)
                        ? 'Save'
                        : hook.state === 'sample' && shown?.text === shown?.saved
                          ? 'Use the example'
                          : 'Create'}
                    </button>
                    {hasScript(hook) && (
                      <button
                        className="btn"
                        disabled={busy || !!edited}
                        title={edited ? 'Save first' : undefined}
                        onClick={() => void toggle()}
                      >
                        {hook.state === 'disabled' ? 'Turn on' : 'Turn off'}
                      </button>
                    )}
                    {hook.runnable && hook.state === 'active' && (
                      <button
                        className="btn"
                        disabled={busy || !!edited}
                        title={edited ? 'Save first' : 'Run it now, as git would, to try it'}
                        onClick={() => void tryIt()}
                      >
                        <Play size={13} /> Run
                      </button>
                    )}
                    <span className="hooks-gap" />
                    {hasScript(hook) && (
                      <button className="btn" disabled={busy} onClick={() => void remove()}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Hooks(): React.JSX.Element | null {
  const session = useUi((s) => s.hooks)
  return session ? <Dialog key={session.repo} session={session} /> : null
}
