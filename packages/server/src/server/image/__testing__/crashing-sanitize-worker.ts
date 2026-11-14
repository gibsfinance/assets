/**
 * Test fixture: a sanitizer worker whose job throws out of the worker, as a bug or an exhausted heap would.
 */
import { parentPort } from 'node:worker_threads'

// Ready once the code has loaded: the pool starts a job's budget only after this message.
parentPort?.postMessage({ ready: true })
parentPort?.on('message', () => {
  throw new Error('fixture crash')
})
