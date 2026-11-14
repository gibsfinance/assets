/**
 * Test fixture: a sanitizer worker that stops while it has a job, without answering.
 */
import { parentPort } from 'node:worker_threads'

parentPort?.on('message', () => {
  process.exit(0)
})
