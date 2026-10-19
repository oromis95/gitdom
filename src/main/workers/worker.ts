// Entry of the worker thread (out/main/worker.js): one task per thread, started by run.ts.
import { parentPort } from 'worker_threads'
import { taskHandler, type ToTask } from './tasks'

const port = parentPort!
const handle = taskHandler((message, transfer) => port.postMessage(message, transfer))
port.on('message', (message: ToTask) => handle(message))
