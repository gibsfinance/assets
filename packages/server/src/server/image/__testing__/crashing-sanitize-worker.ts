/**
 * Test fixture: a sanitizer worker whose job throws out of the worker, as a bug or an exhausted heap would.
 */
import { parentPort } from 'node:worker_threads'

parentPort?.on('message', () => {
  throw new Error('fixture crash')
})
