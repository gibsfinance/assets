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
import { sanitizeImage } from '../../sanitize'
import { createConcurrencyGate, GATE_FULL, type ConcurrencyGate } from './concurrency-gate'
import { createFailureMemory } from './plate'

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
  sanitize?: (bytes: Buffer, ext: string) => Promise<Buffer>
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
  sanitize = sanitizeImage,
  gate = createConcurrencyGate({ limit: REMOTE_IMAGE_CONCURRENCY, maxQueue: REMOTE_IMAGE_QUEUE }),
  timeoutMs = REMOTE_IMAGE_TIMEOUT_MS,
  maxBytes = REMOTE_IMAGE_MAX_BYTES,
  ttlMs = REMOTE_IMAGE_CACHE_TTL_MS,
  maxEntries = REMOTE_IMAGE_CACHE_MAX_ENTRIES,
  maxTotalBytes = REMOTE_IMAGE_CACHE_MAX_BYTES,
}: RemoteImageLoaderOptions = {}): RemoteImageLoader {
  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<Buffer | null | typeof REMOTE_IMAGE_SHED>>()
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

  const download = async ({
    cacheKey,
    uri,
    ext,
    deadline,
  }: {
    cacheKey: string
    uri: string
    ext: string
    deadline: AbortSignal
  }): Promise<Buffer | null | typeof REMOTE_IMAGE_SHED> => {
    // The deadline passed while this request waited in line: leave without downloading anything.
    if (deadline.aborted) return REMOTE_IMAGE_SHED
    try {
      const response = await fetchImpl(uri, { signal: deadline })
      if (!response.ok) return refuse(cacheKey)
      const raw = await readCapped(response, maxBytes)
      if (!raw || raw.length === 0) return refuse(cacheKey)
      // Sanitizing runs on this server's processor. A deadline that passes here is the server's load,
      // not the remote's: the request was already answered as shed, and nothing is recorded against
      // the address. The bytes are still kept, so a later request needs no download.
      const bytes = await sanitize(raw, sanitizerExtension(ext))
      remember(cacheKey, bytes)
      return bytes
    } catch {
      return refuse(cacheKey)
    }
  }

  const fetchOnce = async (request: {
    cacheKey: string
    uri: string
    ext: string
  }): Promise<Buffer | null | typeof REMOTE_IMAGE_SHED> => {
    // One deadline from arrival, for the wait in line and the download together.
    const deadline = AbortSignal.timeout(timeoutMs)
    const expired = new Promise<typeof REMOTE_IMAGE_SHED>((resolve) =>
      deadline.addEventListener('abort', () => resolve(REMOTE_IMAGE_SHED), { once: true }),
    )
    const outcome = await Promise.race([gate.run(() => download({ ...request, deadline })), expired])
    // A full line, or a deadline that passes before the answer, is load shedding. A download that is still
    // running when its request is shed finishes on its own, and its bytes or failure are recorded there.
    return outcome === GATE_FULL ? REMOTE_IMAGE_SHED : outcome
  }

  return {
    async load({ uri, ext }) {
      const key = `${ext}\n${uri}`
      const cached = cache.get(key)
      if (cached && cached.expiresAt > now()) return cached.bytes
      forget(key)
      if (failures.has(key)) return null
      const pending = inFlight.get(key) ?? fetchOnce({ cacheKey: key, uri, ext })
      inFlight.set(key, pending)
      try {
        return await pending
      } finally {
        inFlight.delete(key)
      }
    },
    reset() {
      cache.clear()
      cachedBytes = 0
      inFlight.clear()
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
