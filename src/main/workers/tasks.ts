// The work done in a worker thread, so a long computation doesn't hold up the main process and,
// through it, every window: the lines of a time-lapse and the sums of the statistics. The same
// handler runs inside the main process when there's no worker file (the tests run the sources).
import { StringDecoder } from 'string_decoder'
import { NumstatParser, StatsCollector, parseTree } from '../git/statsCollector'
import { computeTimelapse, type TimelapseInput } from '../git/timelapse'

const PROGRESS_INTERVAL = 150

export type TaskStart = { task: 'timelapse'; input: TimelapseInput } | { task: 'statistics' }

/** Messages to a task: its start, then for the statistics `git log` output and its end. */
export type ToTask =
  | ({ kind: 'start' } & TaskStart)
  | { kind: 'chunk'; chunk: Uint8Array }
  | { kind: 'end'; tree: string }

export type FromTask =
  | { kind: 'progress'; commits: number }
  | { kind: 'done'; value: unknown }
  | { kind: 'error'; message: string }

export type Post = (message: FromTask, transfer?: ArrayBuffer[]) => void

/** The typed arrays of a result, moved to the main process instead of copied. */
function buffersOf(value: { born: Int32Array; frames: Int32Array[] }): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  for (const array of [value.born, ...value.frames]) buffers.add(array.buffer as ArrayBuffer)
  return [...buffers]
}

/** Handles the messages of one task; its results and errors go to `post`. */
export function taskHandler(post: Post): (message: ToTask) => void {
  let stats: {
    collector: StatsCollector
    parser: NumstatParser
    decoder: StringDecoder
    reported: number
  } | null = null

  return (message) => {
    try {
      if (message.kind === 'start' && message.task === 'timelapse') {
        const value = computeTimelapse(message.input)
        post({ kind: 'done', value }, buffersOf(value))
      } else if (message.kind === 'start') {
        const collector = new StatsCollector()
        const parser = new NumstatParser(collector)
        stats = { collector, parser, decoder: new StringDecoder('utf8'), reported: 0 }
      } else if (message.kind === 'chunk' && stats) {
        const { chunk } = message
        stats.parser.push(
          stats.decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
        )
        if (Date.now() - stats.reported > PROGRESS_INTERVAL) {
          stats.reported = Date.now()
          post({ kind: 'progress', commits: stats.collector.commits })
        }
      } else if (message.kind === 'end' && stats) {
        stats.parser.push(stats.decoder.end())
        stats.parser.end()
        post({ kind: 'done', value: stats.collector.result(parseTree(message.tree)) })
      }
    } catch (e) {
      post({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
}
