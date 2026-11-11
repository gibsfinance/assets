import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashBytes } from '../hash'
import type { BlobStat, BlobStore } from '../types'

/** What a contract run needs from the adapter under test. */
export type ContractSubject = {
  /** A store that holds nothing. */
  store: BlobStore
  /**
   * What the store believes the time is, in milliseconds. A fake service reports its own clock;
   * a real one reports `Date.now`.
   */
  clock: () => number
  /**
   * Lets enough time pass for a blob's modification time to change when it is renewed: a clock
   * step for a fake, a sleep longer than the service's timestamp resolution for a real one.
   */
  advanceClock: () => Promise<void>
  /** Releases what the subject holds: a directory, a bucket, a container. */
  cleanup?: () => Promise<void>
}

/** Options for {@link describeBlobStoreContract}. */
export type ContractOptions = {
  /** Skips the whole suite, with a reason shown in the test report. */
  skipReason?: string
  /** Time allowed for each test, in milliseconds. Emulators need more than memory does. */
  timeoutMs?: number
  /**
   * Skips the one test that needs a renewal to move the modification time, for an emulator that
   * does not implement that. The reason is shown in the test report. Never set it for a real service.
   */
  renewalLimitation?: string
  /** How far `modifiedAtMs` may be from the clock right after a write. Defaults to two minutes. */
  clockToleranceMs?: number
}

const sorted = (stats: BlobStat[]): BlobStat[] => [...stats].sort((a, b) => a.sha256.localeCompare(b.sha256))

const collect = async (store: BlobStore): Promise<BlobStat[]> => {
  const found: BlobStat[] = []
  for await (const stat of store.list()) found.push(stat)
  return found
}

const MALFORMED_DIGESTS = ['', 'abc', '../etc/passwd', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]

/**
 * The behaviour every {@link BlobStore} must show, written once and run against each adapter
 * and each composite.
 *
 * A store passes when it keeps bytes under their own digest, answers null or false for what it
 * does not have, refuses a malformed digest without touching storage, lists everything across
 * as many pages as the service needs, and gives `stat` and `list` a modification time that a
 * reuse of the blob moves forward.
 *
 * @param name The adapter's name, for the report.
 * @param createSubject Builds a fresh, empty subject for each test.
 * @param options See {@link ContractOptions}.
 */
export function describeBlobStoreContract(
  name: string,
  createSubject: () => Promise<ContractSubject>,
  options: ContractOptions = {},
): void {
  const { skipReason, timeoutMs = 30_000, clockToleranceMs = 2 * 60 * 1000, renewalLimitation } = options
  const renewalTest = renewalLimitation ? it.skip : it
  const suite = skipReason ? describe.skip : describe

  suite(`BlobStore contract: ${name}`, { timeout: timeoutMs }, () => {
    let subject: ContractSubject
    let store: BlobStore

    beforeEach(async () => {
      subject = await createSubject()
      store = subject.store
    })

    afterEach(async () => {
      await subject.cleanup?.()
    })

    it('stores bytes under their own digest and says so', async () => {
      const bytes = Buffer.from('a blob worth keeping')

      expect(await store.put(bytes)).toEqual({ sha256: hashBytes(bytes), byteSize: bytes.length })
    })

    it('reads back exactly the bytes it was given, for every byte value', async () => {
      const bytes = Buffer.from(Array.from({ length: 256 }, (_value, index) => index))
      const { sha256 } = await store.put(bytes)

      expect(await store.get(sha256)).toEqual(bytes)
    })

    it('keeps an empty blob', async () => {
      const { sha256, byteSize } = await store.put(Buffer.alloc(0))

      expect(byteSize).toBe(0)
      expect(await store.get(sha256)).toEqual(Buffer.alloc(0))
      expect(await store.stat(sha256)).toEqual(expect.objectContaining({ sha256, byteSize: 0 }))
    })

    it('answers null for a blob that was never stored, from get and from stat', async () => {
      const missing = hashBytes(Buffer.from('never stored'))

      expect(await store.get(missing)).toBeNull()
      expect(await store.stat(missing)).toBeNull()
    })

    it('answers false when it deletes a blob that is not there', async () => {
      expect(await store.delete(hashBytes(Buffer.from('never stored')))).toBe(false)
    })

    it('describes a stored blob without reading it, with a modification time near the clock', async () => {
      const bytes = Buffer.from('describe me')
      const { sha256 } = await store.put(bytes)

      const found = await store.stat(sha256)

      expect(found).toEqual({ sha256, byteSize: bytes.length, modifiedAtMs: expect.any(Number) })
      expect(Math.abs((found?.modifiedAtMs as number) - subject.clock())).toBeLessThan(clockToleranceMs)
    })

    it('removes a blob, and only that blob', async () => {
      const kept = await store.put(Buffer.from('kept'))
      const removed = await store.put(Buffer.from('removed'))

      expect(await store.delete(removed.sha256)).toBe(true)

      expect(await store.get(removed.sha256)).toBeNull()
      expect(await store.stat(removed.sha256)).toBeNull()
      expect(await store.delete(removed.sha256)).toBe(false)
      expect(await store.get(kept.sha256)).toEqual(Buffer.from('kept'))
    })

    it('stores the same bytes once, however many times they are put', async () => {
      const bytes = Buffer.from('the same picture')

      const results = await Promise.all([store.put(bytes), store.put(bytes), store.put(bytes)])
      await store.put(bytes)

      expect(new Set(results.map((result) => result.sha256)).size).toBe(1)
      expect(await collect(store)).toHaveLength(1)
      expect(await store.get(results[0].sha256)).toEqual(bytes)
    })

    renewalTest(`moves the modification time forward when a stored blob is put again`, async () => {
      const bytes = Buffer.from('reused blob')
      const { sha256 } = await store.put(bytes)
      const before = (await store.stat(sha256))?.modifiedAtMs as number
      await subject.advanceClock()

      await store.put(bytes)

      const after = await store.stat(sha256)
      expect(after?.modifiedAtMs).toBeGreaterThan(before)
      expect(await store.get(sha256)).toEqual(bytes)
      expect((await collect(store))[0].modifiedAtMs).toBe(after?.modifiedAtMs)
    })

    it('lists nothing when it holds nothing', async () => {
      expect(await collect(store)).toEqual([])
    })

    it('lists every blob with its length and modification time, across as many pages as it takes', async () => {
      const blobs = Array.from({ length: 7 }, (_value, index) => Buffer.from(`blob number ${index} `.repeat(index + 1)))
      for (const bytes of blobs) await store.put(bytes)

      const listed = await collect(store)

      expect(sorted(listed)).toEqual(
        sorted(
          blobs.map((bytes) => ({
            sha256: hashBytes(bytes),
            byteSize: bytes.length,
            modifiedAtMs: expect.any(Number),
          })),
        ),
      )
    })

    it('agrees with itself: list and stat give the same answer for a blob', async () => {
      const { sha256 } = await store.put(Buffer.from('consistent'))

      expect((await collect(store))[0]).toEqual(await store.stat(sha256))
    })

    it.each(MALFORMED_DIGESTS)('refuses the malformed digest %j before it touches storage', async (digest) => {
      await expect(store.get(digest)).rejects.toBeInstanceOf(TypeError)
      await expect(store.stat(digest)).rejects.toBeInstanceOf(TypeError)
      await expect(store.delete(digest)).rejects.toBeInstanceOf(TypeError)
    })
  })
}
