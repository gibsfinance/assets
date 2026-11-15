/**
 * Test fixture: a sanitizer worker that takes every job and never answers, so a deadline has to stop it.
 */
import { parentPort } from 'node:worker_threads'

// Ready once the code has loaded: the pool starts a job's budget only after this message.
parentPort?.postMessage({ ready: true })
parentPort?.on('message', () => undefined)
