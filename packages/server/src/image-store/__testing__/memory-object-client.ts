import type { ObjectClient, ObjectInfo } from '../object-blob-store'
import type { FakeClock } from './fake-clock'

/** An {@link ObjectClient} that keeps objects in memory, for tests of the layer above it. */
export type MemoryObjectClient = ObjectClient & {
  /** The objects, by key. */
  objects: Map<string, { bytes: Buffer; modifiedAtMs: number }>
  /** Makes the next `renew` throw, as a service that does not support it would. */
  failRenewals: () => void
  /** Keys passed to `put`, in call order. */
  puts: string[]
}

/**
 * Builds an empty in-memory object client.
 *
 * @param clock The clock that stamps writes and renewals.
 * @param pageSize How many entries one page of a listing holds, so paging is exercised.
 */
export function createMemoryObjectClient(clock: FakeClock, pageSize = 3): MemoryObjectClient {
  const objects = new Map<string, { bytes: Buffer; modifiedAtMs: number }>()
  const puts: string[] = []
  let renewalsFail = false
  const describe = (key: string): ObjectInfo => {
    const object = objects.get(key) as { bytes: Buffer; modifiedAtMs: number }
    return { key, byteSize: object.bytes.length, modifiedAtMs: object.modifiedAtMs }
  }
  return {
    objects,
    puts,
    failRenewals: () => {
      renewalsFail = true
    },
    put: async (key, bytes) => {
      puts.push(key)
      objects.set(key, { bytes: Buffer.from(bytes), modifiedAtMs: clock.now() })
    },
    get: async (key) => objects.get(key)?.bytes ?? null,
    head: async (key) => (objects.has(key) ? describe(key) : null),
    remove: async (key) => {
      objects.delete(key)
    },
    renew: async (key) => {
      if (renewalsFail) throw new Error('renewal not supported')
      ;(objects.get(key) as { modifiedAtMs: number }).modifiedAtMs = clock.now()
    },
    list: async function* (prefix) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()
      for (let start = 0; start < keys.length; start += pageSize) {
        for (const key of keys.slice(start, start + pageSize)) yield describe(key)
      }
    },
  }
}
