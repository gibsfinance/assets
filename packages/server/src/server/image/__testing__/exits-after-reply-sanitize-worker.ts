/**
 * Test fixture: a sanitizer worker that answers a job and then stops while it is idle.
 */
import { parentPort } from 'node:worker_threads'

parentPort?.on('message', () => {
  parentPort?.postMessage({ ok: false, message: 'refused by the fixture' })
  setTimeout(() => process.exit(0), 20)
})
