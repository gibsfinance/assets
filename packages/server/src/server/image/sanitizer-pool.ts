/**
 * @module image/sanitizer-pool
 * Runs the sanitizer for the bytes of remote images on worker threads, under a sanitizing budget.
 *
 * The sanitizer is synchronous work. On the main thread it cannot be interrupted, so one crafted remote
 * file could hold the event loop, and every other request with it, for as long as it liked. Here a job runs
 * in a worker. The budget for a job starts when a worker is granted to it, not when the request started, so
 * the time a file spends waiting behind another file is not charged to it. A job that runs out of its budget
 * is stopped, and it is charged to its address.
 *
 * Each worker runs one job at a time. At most `size` jobs run at once, and a stopped worker counts against
 * `size` until it has exited. A job waits for a worker without limit, and a job that no request wants any more
 * is not run. A worker is started on first use, and it is stopped after `SANITIZER_IDLE_MS` with no job, so
 * the memory a worker holds exists only while remote files are being cleaned.
 *
 * An answer is one of: sanitized; refused (the file caused it: the sanitizer refused it, or the worker ran out
 * of memory on it); cut off (the file's sanitizing ran out of its budget); unavailable (the worker could not
 * do the job for reasons that are not the file's: it did not start, did not load, or crashed, or the pool is
 * closed); or expired in the queue (no request wanted the file by the time a worker was granted).
 */
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { failureLog } from '@gibs/utils'
import { copyToOwnBuffer, type SanitizeJobReply, type SanitizeJobRequest } from './sanitize-job'

/**
 * Workers that may sanitize at once. One worker costs about 33 megabytes while it exists (measured under the
 * production loader; see CLAUDE.md), so it is the default.
 */
export const SANITIZER_POOL_SIZE = 1

/** How long a worker may sit with no job before it is stopped, in milliseconds. */
export const SANITIZER_IDLE_MS = 60_000

/**
 * How long one file may take to sanitize once a worker has been granted to it, in milliseconds. The wait for
 * a worker is not part of it.
 */
export const SANITIZE_TIMEOUT_MS = 5_000

/** Schedules the idle stop. Tests inject a clock; the default is the process timer, which does not keep it alive. */
export interface SanitizerTimers {
  set: (callback: () => void, milliseconds: number) => unknown
  clear: (handle: unknown) => void
}

const processTimers: SanitizerTimers = {
  set: (callback, milliseconds) => {
    const handle = setTimeout(callback, milliseconds)
    handle.unref()
    return handle
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * Heap a worker may grow to, in megabytes. A worker past it is stopped by the runtime, and the job is
 * refused. A remote file is at most 512 KB, so its tree is far below this.
 */
export const SANITIZER_WORKER_HEAP_MB = 256

/** The message of a job answered after the pool was closed. */
const CLOSED = 'sanitizer pool closed'

/** The error code the runtime gives a worker stopped for running out of its heap. */
const OUT_OF_MEMORY = 'ERR_WORKER_OUT_OF_MEMORY'

/** How one sanitizing attempt ended. */
export type SanitizeAttempt =
  | { status: 'sanitized'; bytes: Buffer }
  /** The file caused it: the sanitizer refused the file, or the worker ran out of memory on it. Charged. */
  | { status: 'refused'; message: string }
  /** The file's sanitizing ran out of its budget once a worker was granted, so the worker was stopped. Charged. */
  | { status: 'cut-off' }
  /** The worker could not do the job, for reasons that are not the file's. Nothing is charged. */
  | { status: 'unavailable'; message: string }
  /** No request wanted the file by the time a worker was granted, so it was not run. Nothing is charged. */
  | { status: 'expired-in-queue' }

/** Runs sanitizing jobs for the remote loader. */
export interface SanitizerRunner {
  /**
   * Sanitize `bytes`, once a worker is granted to them and `wanted` still answers true at that moment.
   *
   * @param request The bytes and the extension they were fetched under.
   * @param wanted Whether a request is still waiting for the file. Checked when a worker is granted.
   * @returns How the attempt ended.
   */
  run: (request: { bytes: Buffer; ext: string }, wanted: () => boolean) => Promise<SanitizeAttempt>
  /** Worker threads alive now, busy, idle or stopping. Housekeeping and tests. */
  workers: () => number
  /** The most worker threads alive at once since the runner was built. Tests. */
  workersPeak: () => number
  /** Worker threads started since the runner was built, including those since stopped. Tests. */
  workersStarted: () => number
  /** Stops every worker, and fails every job waiting for one. Later jobs answer unavailable. */
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
 * A runner that sanitizes on the calling thread. It has no budget, because the sanitizer cannot be interrupted
 * there. The remote loader takes one only when a test injects a sanitizer.
 *
 * @param sanitize The sanitizer to call.
 * @returns A runner over `sanitize`.
 */
export function createInProcessSanitizer(sanitize: (bytes: Buffer, ext: string) => Promise<Buffer>): SanitizerRunner {
  return {
    run: async ({ bytes, ext }) => ({ status: 'sanitized', bytes: await sanitize(bytes, ext) }),
    workers: () => 0,
    workersPeak: () => 0,
    workersStarted: () => 0,
    close: () => undefined,
  }
}

/**
 * Build a pool of sanitizer workers. No worker starts until a job needs one.
 *
 * @param options.size Jobs that may run at once, and so the most workers alive while busy.
 * @param options.workerUrl The worker's entry. Tests point it at a fixture.
 * @param options.budgetMs The sanitizing budget of one file, from the moment its worker is granted.
 * @returns The runner.
 */
export function createSanitizerPool({
  size = SANITIZER_POOL_SIZE,
  workerUrl = DEFAULT_WORKER_URL,
  idleMs = SANITIZER_IDLE_MS,
  budgetMs = SANITIZE_TIMEOUT_MS,
  timers = processTimers,
}: {
  size?: number
  workerUrl?: URL
  idleMs?: number
  budgetMs?: number
  timers?: SanitizerTimers
} = {}): SanitizerRunner {
  const alive = new Set<Worker>()
  /**
   * Whether each worker has started: resolves null once its code has loaded (its ready message), or with the
   * reason it failed first. Loading is not part of a file's budget, so a job waits for this before its budget starts.
   */
  const readiness = new Map<Worker, Promise<string | null>>()
  const idle: Worker[] = []
  /** The idle stop scheduled for each worker in `idle`. A worker that takes a job has its stop cancelled. */
  const idleStops = new Map<Worker, unknown>()
  let started = 0
  let peak = 0
  let closed = false
  let freeSlots = size
  const waitingForSlot: ((granted: boolean) => void)[] = []
  /** Messages already reported to the failure log, so a fault that repeats is reported once. */
  const reported = new Set<string>()

  // A slot passes straight to the next job in line, so a newcomer cannot take it ahead of the line. A job
  // waiting for a slot is answered false when the pool closes.
  const takeSlot = (): Promise<boolean> => {
    if (closed) return Promise.resolve(false)
    if (freeSlots > 0) {
      freeSlots -= 1
      return Promise.resolve(true)
    }
    return new Promise<boolean>((resolve) => waitingForSlot.push(resolve))
  }
  const giveSlot = (): void => {
    const next = waitingForSlot.shift()
    if (next) next(true)
    else freeSlots += 1
  }

  const unavailable = (message: string): SanitizeAttempt => {
    if (!reported.has(message)) {
      reported.add(message)
      failureLog(`sanitizer unavailable: ${message}`)
    }
    return { status: 'unavailable', message }
  }

  const startWorker = (): Worker => {
    const worker = new Worker(workerUrl, {
      execArgv: ['--import', REGISTER_HOOKS],
      resourceLimits: { maxOldGenerationSizeMb: SANITIZER_WORKER_HEAP_MB },
    })
    // Not kept alive by the worker: a server that is stopping should not wait for an idle sanitizer.
    worker.unref()
    alive.add(worker)
    readiness.set(
      worker,
      new Promise<string | null>((resolve) => {
        worker.once('message', () => resolve(null))
        worker.once('error', (error) => resolve(error.message))
        worker.once('exit', () => resolve('stopped before it started'))
      }),
    )
    started += 1
    peak = Math.max(peak, alive.size)
    // A failure is reported to the job that was running on the worker (see `runJob`). With no job running,
    // the error has nowhere to go, and an unhandled one would stop the process.
    worker.on('error', () => undefined)
    worker.once('exit', () => {
      alive.delete(worker)
      readiness.delete(worker)
      const index = idle.indexOf(worker)
      if (index >= 0) idle.splice(index, 1)
      cancelIdleStop(worker)
    })
    return worker
  }

  /** Cancel the idle stop of `worker`, if one is scheduled. */
  const cancelIdleStop = (worker: Worker): void => {
    const handle = idleStops.get(worker)
    if (handle === undefined) return
    timers.clear(handle)
    idleStops.delete(worker)
  }

  /**
   * Stop an idle worker. The stop is a no-op for a worker that is not idle: a worker running a job is never
   * stopped here, and the stop of a worker that took a job is cancelled when the job took it.
   */
  const stopIdleWorker = (worker: Worker): void => {
    idleStops.delete(worker)
    const index = idle.indexOf(worker)
    if (index < 0) return
    idle.splice(index, 1)
    void worker.terminate()
  }

  /** Put a worker back in line for the next job, with its idle stop scheduled. */
  const parkWorker = (worker: Worker): void => {
    idle.push(worker)
    idleStops.set(
      worker,
      timers.set(() => stopIdleWorker(worker), idleMs),
    )
  }

  /** The worker for the next job: an idle one, whose stop is cancelled, else a new one. */
  const takeWorker = (): Worker => {
    const worker = idle.pop()
    if (!worker) return startWorker()
    cancelIdleStop(worker)
    return worker
  }

  /** Give the job to `worker` and wait for its reply, a failure, its exit or the budget, whichever comes first. */
  const runJob = (worker: Worker, request: { bytes: Buffer; ext: string }, budget: AbortSignal): Promise<JobResult> =>
    new Promise<JobResult>((resolve) => {
      const finish = (result: JobResult): void => {
        worker.off('message', onMessage)
        worker.off('error', onError)
        worker.off('exit', onExit)
        budget.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const onMessage = (reply: SanitizeJobReply): void => finish({ attempt: attemptOf(reply), reusable: true })
      // The worker had reported ready, so it was running this file's job when it failed. A crash then is charged to
      // the file, whatever the error: otherwise a crafted file that crashes the worker would be retried on every
      // request, restarting the worker each time. A worker stopped by its heap limit ran out of memory on the file.
      // A failure before ready is not reached here (see `readiness`).
      const onError = (error: Error & { code?: string }): void =>
        finish({
          attempt:
            error.code === OUT_OF_MEMORY
              ? { status: 'refused', message: 'sanitizer worker ran out of memory' }
              : { status: 'refused', message: `sanitizer worker crashed on this file: ${error.message}` },
          reusable: false,
        })
      // A pool closed while the job ran answers unavailable; any other stop of a running worker crashed on the file.
      const onExit = (): void =>
        finish({
          attempt: closed
            ? unavailable(CLOSED)
            : { status: 'refused', message: 'sanitizer worker stopped while running this file' },
          reusable: false,
        })
      const onAbort = (): void => finish({ attempt: { status: 'cut-off' }, reusable: false })

      worker.on('message', onMessage)
      worker.on('error', onError)
      worker.once('exit', onExit)
      budget.addEventListener('abort', onAbort, { once: true })
      const bytes = copyToOwnBuffer(request.bytes)
      const job: SanitizeJobRequest = { bytes, ext: request.ext }
      worker.postMessage(job, [bytes.buffer])
    })

  const run = async (request: { bytes: Buffer; ext: string }, wanted: () => boolean): Promise<SanitizeAttempt> => {
    if (!(await takeSlot())) return unavailable(CLOSED)
    try {
      // The pool may have closed while this job held a slot, between the grant and this line.
      if (closed) return unavailable(CLOSED)
      if (!wanted()) return { status: 'expired-in-queue' }
      const worker = takeWorker()
      const failure = await readiness.get(worker)!
      if (failure !== null) {
        await worker.terminate()
        return unavailable(closed ? CLOSED : `sanitizer worker failed: ${failure}`)
      }
      // The budget starts now, once the worker is online, and not when the request started.
      const result = await runJob(worker, request, AbortSignal.timeout(budgetMs))
      if (result.reusable) parkWorker(worker)
      else await worker.terminate()
      return result.attempt
    } finally {
      // A slot is given back only once the worker that held it has exited, so the pool never has more workers
      // alive than its size. `terminate` resolves when the worker has exited.
      giveSlot()
    }
  }

  return {
    run,
    workers: () => alive.size,
    workersPeak: () => peak,
    workersStarted: () => started,
    close: () => {
      closed = true
      for (const resolve of waitingForSlot.splice(0)) resolve(false)
      for (const handle of idleStops.values()) timers.clear(handle)
      idleStops.clear()
      for (const worker of alive) void worker.terminate()
    },
  }
}
