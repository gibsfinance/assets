/**
 * @module image/sanitizer-pool
 * Runs the sanitizer for the bytes of remote images on worker threads, under a hard time limit.
 *
 * The sanitizer is synchronous work. On the main thread it cannot be interrupted, so one crafted remote
 * file could hold the event loop, and every other request with it, for as long as it liked. Here a job runs
 * in a worker. If the request's deadline passes while the worker is still running it, the worker is
 * terminated, and the request is answered without the image.
 *
 * Each worker runs one job at a time. At most `size` jobs run at once, and a job waiting for a slot
 * waits without limit: the number of waiting jobs is bounded by the remote loader's download limit,
 * which is the only caller. A worker is started on first use and reused, so an idle server holds none.
 */
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { copyToOwnBuffer, type SanitizeJobReply, type SanitizeJobRequest } from './sanitize-job'

/** Workers that may sanitize at once. Two keeps a single crafted file from holding every slot for long. */
export const SANITIZER_POOL_SIZE = 2

/**
 * Heap a worker may grow to, in megabytes. A worker past it is stopped by the runtime, and the job is
 * refused. A remote file is at most 512 KB, so its tree is far below this.
 */
export const SANITIZER_WORKER_HEAP_MB = 256

/** How one sanitizing attempt ended. */
export type SanitizeAttempt =
  | { status: 'sanitized'; bytes: Buffer }
  /** The sanitizer refused the file, or the worker failed on it. The file is charged. */
  | { status: 'refused'; message: string }
  /** The deadline passed before a worker was free, so the job never ran. Nothing is charged. */
  | { status: 'expired-in-queue' }
  /** The deadline passed while a worker was running the job, so the worker was stopped. The file is charged. */
  | { status: 'cut-off' }

/** Runs sanitizing jobs for the remote loader. */
export interface SanitizerRunner {
  /**
   * Sanitize `bytes`, giving up when `deadline` aborts.
   *
   * @param request The bytes and the extension they were fetched under.
   * @param deadline The request's deadline.
   * @returns How the attempt ended.
   */
  run: (request: { bytes: Buffer; ext: string }, deadline: AbortSignal) => Promise<SanitizeAttempt>
  /** Worker threads alive now, busy or idle. Housekeeping and tests. */
  workers: () => number
  /** Stops every worker. A job still running is refused. */
  close: () => void
}

/** The worker entry, `bin/sanitize-worker.ts`, next to the bin directory. */
const DEFAULT_WORKER_URL = new URL('../../bin/sanitize-worker.ts', import.meta.url)

/** The loader the server runs under, so a worker resolves its imports exactly as the server does. */
const REGISTER_HOOKS = fileURLToPath(new URL('../../bin/register-hooks.ts', import.meta.url))

/** What one job reports when it is finished with its worker. */
interface JobResult {
  attempt: SanitizeAttempt
  /** Whether the worker can take another job. A worker that was cut off, failed or stopped cannot. */
  reusable: boolean
}

/** The attempt a worker's reply stands for. */
function attemptOf(reply: SanitizeJobReply): SanitizeAttempt {
  if (!reply.ok) return { status: 'refused', message: reply.message }
  return { status: 'sanitized', bytes: Buffer.from(reply.bytes.buffer, reply.bytes.byteOffset, reply.bytes.byteLength) }
}

/**
 * A runner that sanitizes on the calling thread. It has no time limit, because the sanitizer cannot be
 * interrupted there. The remote loader takes one only when a test injects a sanitizer.
 *
 * @param sanitize The sanitizer to call.
 * @returns A runner over `sanitize`.
 */
export function createInProcessSanitizer(sanitize: (bytes: Buffer, ext: string) => Promise<Buffer>): SanitizerRunner {
  return {
    run: async ({ bytes, ext }) => ({ status: 'sanitized', bytes: await sanitize(bytes, ext) }),
    workers: () => 0,
    close: () => undefined,
  }
}

/**
 * Build a pool of sanitizer workers. No worker starts until a job needs one.
 *
 * @param options.size Jobs that may run at once, and so the most workers alive while busy.
 * @param options.workerUrl The worker's entry. Tests point it at a fixture.
 * @returns The runner.
 */
export function createSanitizerPool({
  size = SANITIZER_POOL_SIZE,
  workerUrl = DEFAULT_WORKER_URL,
}: { size?: number; workerUrl?: URL } = {}): SanitizerRunner {
  const alive = new Set<Worker>()
  const idle: Worker[] = []
  let freeSlots = size
  const waitingForSlot: (() => void)[] = []

  // A slot passes straight to the next job in line, so a newcomer cannot take it ahead of the line.
  const takeSlot = (): Promise<void> => {
    if (freeSlots > 0) {
      freeSlots -= 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => waitingForSlot.push(resolve))
  }
  const giveSlot = (): void => {
    const next = waitingForSlot.shift()
    if (next) next()
    else freeSlots += 1
  }

  const startWorker = (): Worker => {
    const worker = new Worker(workerUrl, {
      execArgv: ['--import', REGISTER_HOOKS],
      resourceLimits: { maxOldGenerationSizeMb: SANITIZER_WORKER_HEAP_MB },
    })
    // Not kept alive by the worker: a server that is stopping should not wait for an idle sanitizer.
    worker.unref()
    alive.add(worker)
    // A failure is reported to the job that was running on the worker (see `runJob`). With no job running,
    // the error has nowhere to go, and an unhandled one would stop the process.
    worker.on('error', () => undefined)
    worker.once('exit', () => {
      alive.delete(worker)
      const index = idle.indexOf(worker)
      if (index >= 0) idle.splice(index, 1)
    })
    return worker
  }

  /** Give the job to `worker` and wait for its reply, a failure, its exit or the deadline, whichever comes first. */
  const runJob = (worker: Worker, request: { bytes: Buffer; ext: string }, deadline: AbortSignal): Promise<JobResult> =>
    new Promise<JobResult>((resolve) => {
      const finish = (result: JobResult): void => {
        worker.off('message', onMessage)
        worker.off('error', onError)
        worker.off('exit', onExit)
        deadline.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const onMessage = (reply: SanitizeJobReply): void => finish({ attempt: attemptOf(reply), reusable: true })
      const onError = (error: Error): void =>
        finish({
          attempt: { status: 'refused', message: `sanitizer worker failed: ${error.message}` },
          reusable: false,
        })
      const onExit = (): void =>
        finish({ attempt: { status: 'refused', message: 'sanitizer worker stopped' }, reusable: false })
      const onAbort = (): void => finish({ attempt: { status: 'cut-off' }, reusable: false })

      worker.on('message', onMessage)
      worker.on('error', onError)
      worker.once('exit', onExit)
      deadline.addEventListener('abort', onAbort, { once: true })
      const bytes = copyToOwnBuffer(request.bytes)
      const job: SanitizeJobRequest = { bytes, ext: request.ext }
      worker.postMessage(job, [bytes.buffer])
    })

  const run = async (request: { bytes: Buffer; ext: string }, deadline: AbortSignal): Promise<SanitizeAttempt> => {
    await takeSlot()
    try {
      if (deadline.aborted) return { status: 'expired-in-queue' }
      const worker = idle.pop() ?? startWorker()
      const result = await runJob(worker, request, deadline)
      if (result.reusable) idle.push(worker)
      else void worker.terminate()
      return result.attempt
    } finally {
      giveSlot()
    }
  }

  return {
    run,
    workers: () => alive.size,
    close: () => {
      for (const worker of alive) void worker.terminate()
    },
  }
}
