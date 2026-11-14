/**
 * Test fixture: a sanitizer worker that takes its time by marker, to model a queue and a long file. A job whose
 * bytes contain HOLD takes 400 ms, MID takes 300 ms and SLOW takes 900 ms; any other job answers at once with its
 * bytes unchanged.
 */
import { parentPort } from 'node:worker_threads'

const DELAYS: [string, number][] = [
  ['HOLD', 400],
  ['SLOW', 900],
  ['MID', 300],
]

// Ready once the code has loaded: the pool starts a job's budget only after this message.
parentPort?.postMessage({ ready: true })
parentPort?.on('message', (job: { bytes: Uint8Array }) => {
  const text = Buffer.from(job.bytes).toString()
  const delay = DELAYS.find(([marker]) => text.includes(marker))?.[1] ?? 0
  setTimeout(() => {
    const bytes = new Uint8Array(new ArrayBuffer(job.bytes.byteLength))
    bytes.set(job.bytes)
    parentPort?.postMessage({ ok: true, bytes }, [bytes.buffer])
  }, delay)
})
