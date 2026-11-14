/**
 * @module image/remote-image
 * Reads the bytes of a link-mode image from its remote address, for a request that needs to resize
 * or plate them.
 *
 * Without limits, every such request made the server download a file of any size from a host the
 * caller never named, and a caller who varied the query could make it do that at will. Here the
 * download has a size cap (read as a stream, so an oversized body is dropped as soon as it passes
 * the cap), a short timeout, a limit on how many downloads run at once, and a small cache that holds
 * the sanitized bytes briefly by address, so a page of requests for one logo downloads it once. A
 * failed download is remembered for a minute, so a dead link is not tried on every request.
 *
 * The bytes are sanitized before they are returned, exactly as bytes are before they are stored:
 * a remote file is as untrusted as an upload.
 */
import { createConcurrencyGate, GATE_FULL, type ConcurrencyGate } from './concurrency-gate'
import { createFailureMemory } from './plate'
import { createInProcessSanitizer, createSanitizerPool, type SanitizerRunner } from './sanitizer-pool'

/** Largest remote image read, in bytes. The same cap as an uploaded image (`image-submit.ts`). */
export const REMOTE_IMAGE_MAX_BYTES = 512 * 1024

/**
 * How long one request may take from the moment it arrives, in milliseconds. One deadline covers
 * the wait in line and the download, so a request that queued behind others cannot wait several
 * times as long as one that did not.
 */
export const REMOTE_IMAGE_TIMEOUT_MS = 5000

/**
 * What `load` answers when the request was turned away for load, not because of the image: the
 * line of downloads was full, or the deadline passed while the request waited. The image may be
 * perfectly good, so a caller that caches its answer should not keep this one for long.
 */
export const REMOTE_IMAGE_SHED = Symbol('remote-image-shed')

/** How long fetched bytes are kept, in milliseconds. */
export const REMOTE_IMAGE_CACHE_TTL_MS = 60_000

/** Most addresses kept at once. */
export const REMOTE_IMAGE_CACHE_MAX_ENTRIES = 200

/** Most bytes kept at once, over all addresses. */
export const REMOTE_IMAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024

/** Downloads that may run at once, and how many more may wait. */
export const REMOTE_IMAGE_CONCURRENCY = 4
export const REMOTE_IMAGE_QUEUE = 16

interface CacheEntry {
  bytes: Buffer
  expiresAt: number
}

export interface RemoteImageLoaderOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  /**
   * Sanitizes on the calling thread, with no time limit. Tests use it. Without it, and without `sanitizer`,
   * the loader sanitizes on worker threads (see `sanitizer-pool.ts`).
   */
  sanitize?: (bytes: Buffer, ext: string) => Promise<Buffer>
  /** Runs the sanitizer. The default is a pool of worker threads, each job under the request's deadline. */
  sanitizer?: SanitizerRunner
  gate?: ConcurrencyGate
  /** Deadline for one request, from its arrival. Defaults to `REMOTE_IMAGE_TIMEOUT_MS`. */
  timeoutMs?: number
  maxBytes?: number
  ttlMs?: number
  maxEntries?: number
  maxTotalBytes?: number
}

export interface RemoteImageLoader {
  /**
   * The sanitized bytes at `uri`. Null when they cannot be had because of the image (failed, refused
   * or too large). `REMOTE_IMAGE_SHED` when the request was turned away for load.
   */
  load: (request: { uri: string; ext: string }) => Promise<Buffer | null | typeof REMOTE_IMAGE_SHED>
  /** Forget every cached download and remembered failure. */
  reset: () => void
  /** Addresses cached now. */
  readonly size: number
}

/**
 * Read a response body up to `maxBytes`. Null when it is longer, in which case the rest is never read.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    return null
  }
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** The stored extension names a vector as `.svg+xml` in old rows; the sanitizer knows `.svg`. */
function sanitizerExtension(ext: string): string {
  return ext === '.svg+xml' ? '.svg' : ext
}

/**
 * Build a loader with its own cache, failure memory and download limit.
 */
export function createRemoteImageLoader({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
  sanitize,
  sanitizer = sanitize ? createInProcessSanitizer(sanitize) : createSanitizerPool(),
  gate = createConcurrencyGate({ limit: REMOTE_IMAGE_CONCURRENCY, maxQueue: REMOTE_IMAGE_QUEUE }),
  timeoutMs = REMOTE_IMAGE_TIMEOUT_MS,
  maxBytes = REMOTE_IMAGE_MAX_BYTES,
  ttlMs = REMOTE_IMAGE_CACHE_TTL_MS,
  maxEntries = REMOTE_IMAGE_CACHE_MAX_ENTRIES,
  maxTotalBytes = REMOTE_IMAGE_CACHE_MAX_BYTES,
}: RemoteImageLoaderOptions = {}): RemoteImageLoader {
  const cache = new Map<string, CacheEntry>()
  /** The fetch for each address that is running. */
  const inFlight = new Map<string, Promise<Buffer | null | typeof REMOTE_IMAGE_SHED>>()
  /** How many requests are waiting for each address. */
  const waiting = new Map<string, number>()
  let failures = createFailureMemory({ now })
  let cachedBytes = 0

  const forget = (key: string): void => {
    const entry = cache.get(key)
    if (!entry) return
    cachedBytes -= entry.bytes.length
    cache.delete(key)
  }

  const remember = (key: string, bytes: Buffer): void => {
    forget(key)
    cache.set(key, { bytes, expiresAt: now() + ttlMs })
    cachedBytes += bytes.length
    // The oldest entry goes first; the Map keeps insertion order.
    while (cache.size > maxEntries || cachedBytes > maxTotalBytes) forget(cache.keys().next().value!)
  }

  /**
   * Remember that the remote failed to give a usable file, and answer the caller with no image. Only
   * the remote's failures come here: a network error or an aborted call, a non-success answer, an
   * oversized or empty body, or a refused file.
   */
  const refuse = (cacheKey: string): null => {
    failures.record(cacheKey)
    return null
  }

  /** What the network call and the body gave, before any sanitizing. */
  type Fetched = { status: 'fetched'; raw: Buffer } | { status: 'refused' } | { status: 'shed' }

  /**
   * Fetch one file's bytes. The window of `timeoutMs`, from the moment the call starts, covers the network call and
   * the body. Only this step runs under the fetch gate: a file waiting for a sanitizer worker holds no fetch slot.
   * A file nobody waits for is not fetched; its entry goes at once, so a request that arrives now starts its own.
   */
  const fetchBytes = async (cacheKey: string, uri: string): Promise<Fetched> => {
    if (!isWanted(cacheKey)) {
      inFlight.delete(cacheKey)
      return { status: 'shed' }
    }
    const window = AbortSignal.timeout(timeoutMs)
    try {
      const response = await fetchImpl(uri, { signal: window })
      if (!response.ok) return { status: 'refused' }
      const raw = await readCapped(response, maxBytes)
      if (!raw || raw.length === 0) return { status: 'refused' }
      return { status: 'fetched', raw }
    } catch {
      // A failed call, or a window that ended before the answer: the remote had its full window and did not
      // answer in it, so the address is charged.
      return { status: 'refused' }
    }
  }

  /**
   * Clean the fetched bytes. This runs outside the fetch gate, in the sanitizer's queue, which is bounded (see
   * `sanitizer-pool.ts`). A success is kept. Bytes that were not cleaned are never served and never kept: when the
   * queue sheds them, or the sanitizer is unavailable, they are dropped and the next request fetches again.
   */
  const cleanFetched = async (
    cacheKey: string,
    ext: string,
    raw: Buffer,
  ): Promise<Buffer | null | typeof REMOTE_IMAGE_SHED> => {
    try {
      const attempt = await sanitizer.run({ bytes: raw, ext: sanitizerExtension(ext) }, () => isWanted(cacheKey))
      if (attempt.status === 'sanitized') {
        remember(cacheKey, attempt.bytes)
        return attempt.bytes
      }
      // Nobody waits for the file any more, the queue was full or too long, or the sanitizer could not run it for
      // reasons that are not the file's: nothing is charged, and the next request tries again.
      if (attempt.status === 'expired-in-queue' || attempt.status === 'unavailable') return REMOTE_IMAGE_SHED
      // A file the sanitizer refused, or one whose sanitizing ran out of its budget: the file's own work caused
      // it, so the address is charged, as a file that fails to download is.
      return refuse(cacheKey)
    } catch {
      // A sanitizer that throws (the test seam sanitizes in-process) has refused the file.
      return refuse(cacheKey)
    }
  }

  /**
   * Start the one fetch for an address. It stays in `inFlight` until it settles, so the requests that arrive
   * meanwhile join it instead of starting another. A full fetch line answers shed.
   */
  const startFetch = (
    cacheKey: string,
    uri: string,
    ext: string,
  ): Promise<Buffer | null | typeof REMOTE_IMAGE_SHED> => {
    const fetching = gate
      .run(() => fetchBytes(cacheKey, uri))
      .then((fetched) => {
        if (fetched === GATE_FULL || fetched.status === 'shed') return REMOTE_IMAGE_SHED
        if (fetched.status === 'refused') return refuse(cacheKey)
        return cleanFetched(cacheKey, ext, fetched.raw)
      })
    inFlight.set(cacheKey, fetching)
    void fetching.finally(() => {
      if (inFlight.get(cacheKey) === fetching) inFlight.delete(cacheKey)
    })
    return fetching
  }

  /** Whether a request is still waiting for the file at `key`. */
  const isWanted = (key: string): boolean => (waiting.get(key) ?? 0) > 0

  /** A request starts waiting for `key`. */
  const join = (key: string): void => {
    waiting.set(key, (waiting.get(key) ?? 0) + 1)
  }

  /** A request stops waiting for `key`: its answer is given, or it was shed. */
  const leave = (key: string): void => {
    const remaining = waiting.get(key)! - 1
    if (remaining > 0) waiting.set(key, remaining)
    else waiting.delete(key)
  }

  return {
    async load({ uri, ext }) {
      const key = `${ext}\n${uri}`
      const cached = cache.get(key)
      if (cached && cached.expiresAt > now()) return cached.bytes
      forget(key)
      if (failures.has(key)) return null
      // The request is waiting before its file is started, so that the file is fetched only if someone waits for it.
      join(key)
      try {
        // The request's deadline, from its arrival. It answers this caller; the fetch runs on its own window.
        const arrival = AbortSignal.timeout(timeoutMs)
        const expired = new Promise<typeof REMOTE_IMAGE_SHED>((resolve) =>
          arrival.addEventListener('abort', () => resolve(REMOTE_IMAGE_SHED), { once: true }),
        )
        const fetching = inFlight.get(key) ?? startFetch(key, uri, ext)
        return await Promise.race([fetching, expired])
      } finally {
        leave(key)
      }
    },
    reset() {
      cache.clear()
      cachedBytes = 0
      inFlight.clear()
      waiting.clear()
      failures = createFailureMemory({ now })
    },
    get size() {
      return cache.size
    },
  }
}

/**
 * The one reader of link-mode images that every route shares (resize, plate and sprite). One
 * instance means one download limit, one cache and one failure memory for all outbound fetches, so
 * a client cannot multiply the server's outbound work by spreading requests over several routes.
 */
export const sharedRemoteImages: RemoteImageLoader = createRemoteImageLoader()
