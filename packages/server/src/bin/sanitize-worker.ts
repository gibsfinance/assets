/**
 * @module bin/sanitize-worker
 * The worker thread that sanitizes the bytes of remote images. `server/image/sanitizer-pool.ts` starts
 * one per slot, with the server's own loader (`--import register-hooks.ts`), and sends each job here as a
 * message. What a job does is `runSanitizeJob`, which the tests run on the main thread.
 *
 * It is an entry point, run by a thread rather than imported, so it sits in `bin/` with the other entry
 * points, which the coverage report leaves out.
 */
import { parentPort } from 'node:worker_threads'
import { runSanitizeJob, type SanitizeJobReply, type SanitizeJobRequest } from '../server/image/sanitize-job'

const port = parentPort
if (!port) throw new Error('sanitize-worker must be started as a worker thread')

port.on('message', async (request: SanitizeJobRequest) => {
  const reply: SanitizeJobReply = await runSanitizeJob(request)
  // The sanitized bytes move to the caller rather than being copied; `runSanitizeJob` gave them a buffer of their own.
  port.postMessage(reply, reply.ok ? [reply.bytes.buffer] : [])
})
