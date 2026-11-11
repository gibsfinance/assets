import type { BlobCidIndex, CidRecord } from '../cid-index'

/** A {@link BlobCidIndex} in memory, for tests of the IPFS adapter. */
export type MemoryCidIndex = BlobCidIndex & {
  /** The records, by digest. */
  records: Map<string, CidRecord>
}

/** Builds an empty in-memory index. */
export function createMemoryCidIndex(): MemoryCidIndex {
  const records = new Map<string, CidRecord>()
  return {
    records,
    get: async (sha256) => records.get(sha256) ?? null,
    put: async (record) => {
      records.set(record.sha256, { ...record })
    },
    remove: async (sha256) => records.delete(sha256),
    list: async function* () {
      for (const record of [...records.values()].sort((a, b) => a.sha256.localeCompare(b.sha256))) yield record
    },
  }
}
