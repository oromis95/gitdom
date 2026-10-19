// Starts each task in a worker thread of its own. The unit tests run the sources in Node, with no
// out/main/worker.js: there the tasks run in this process instead.
import { join } from 'path'
import { Worker } from 'worker_threads'
import { taskHandler, type FromTask, type TaskStart, type ToTask } from './tasks'

const WORKER = join(__dirname, 'worker.js')

export interface Task<T> {
  /** More input for the task: the bytes are moved to the worker when nothing else holds them */
  send(message: ToTask): void
  /** Settles when the task is done, fails, or is cancelled */
  result: Promise<T>
}

export interface TaskOptions {
  /** Stops the worker; the result then rejects with "Cancelled" */
  signal?: AbortSignal
  onProgress?: (commits: number) => void
}

/** Whether tasks run in a worker thread: always in GitDom, never in the unit tests. */
export const inWorker = (): boolean => !!process.versions.electron

/** The buffers of a message that can be moved instead of copied: those that are theirs alone. */
function movable(message: ToTask): ArrayBuffer[] {
  const arrays =
    message.kind === 'chunk'
      ? [message.chunk]
      : message.kind === 'start' && message.task === 'timelapse'
        ? [message.input.batch, message.input.onDisk]
        : []
  return arrays
    .filter((a): a is Uint8Array => !!a && a.byteOffset === 0)
    .filter((a) => a.byteLength === a.buffer.byteLength && a.buffer instanceof ArrayBuffer)
    .map((a) => a.buffer as ArrayBuffer)
}

export function startTask<T>(start: TaskStart, { signal, onProgress }: TaskOptions = {}): Task<T> {
  let settle: { resolve: (value: T) => void; reject: (error: Error) => void } | null = null
  const result = new Promise<T>((resolve, reject) => (settle = { resolve, reject }))
  let stop = (): void => {}
  const receive = (message: FromTask): void => {
    if (!settle) return
    if (message.kind === 'progress') return onProgress?.(message.commits)
    const { resolve, reject } = settle
    settle = null
    stop()
    if (message.kind === 'done') resolve(message.value as T)
    else reject(new Error(message.message))
  }

  let deliver: (message: ToTask) => void
  if (inWorker()) {
    const worker = new Worker(WORKER)
    worker.on('message', receive)
    worker.on('error', (e) => receive({ kind: 'error', message: e.message }))
    worker.on('exit', (code) => receive({ kind: 'error', message: `The worker stopped (${code})` }))
    deliver = (message) => worker.postMessage(message, movable(message))
    stop = () => void worker.terminate()
  } else {
    const handle = taskHandler((message) => queueMicrotask(() => receive(message)))
    deliver = handle
  }
  const cancel = (): void => receive({ kind: 'error', message: 'Cancelled' })
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  void result.catch(() => {}).finally(() => signal?.removeEventListener('abort', cancel))

  const send = (message: ToTask): void => {
    if (settle) deliver(message)
  }
  send({ kind: 'start', ...start })
  return { send, result }
}
