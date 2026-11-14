/**
 * Test fixture: a sanitizer worker that stops while it has a job, without answering.
 */
import { parentPort } from 'node:worker_threads'

// Ready once the code has loaded: the pool starts a job's budget only after this message.
parentPort?.postMessage({ ready: true })
parentPort?.on('message', () => {
  process.exit(0)
})
