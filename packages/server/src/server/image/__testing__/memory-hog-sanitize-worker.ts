/**
 * Test fixture: a sanitizer worker that keeps allocating until the runtime stops it for running out of its heap,
 * as a file whose tree is too large would.
 */
import { parentPort } from 'node:worker_threads'

// Ready once the code has loaded: the pool starts a job's budget only after this message.
parentPort?.postMessage({ ready: true })
parentPort?.on('message', () => {
  const hold: number[][] = []
  for (;;) hold.push(new Array(1_000_000).fill(1))
})
