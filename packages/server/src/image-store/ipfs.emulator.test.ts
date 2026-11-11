/**
 * The IPFS adapter against a real Kubo node in Docker, offline. Skipped unless
 * IMAGE_STORE_EMULATORS=1. Kubo is both the pinning API (the Kubo RPC, which Filebase also speaks)
 * and the gateway, so writes, pins, gateway reads and unpins all run for real. The digest-to-CID
 * table is in memory here; its database form has its own tests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeBlobStoreContract } from './__testing__/blob-store-contract'
import {
  EMULATORS_SKIP_REASON,
  emulatorsEnabled,
  pause,
  startEmulator,
  type RunningEmulator,
} from './__testing__/emulator'
import { createMemoryCidIndex } from './__testing__/memory-cid-index'
import { hashBytes } from './hash'
import { createIpfsBlobStore, createPinningClient } from './ipfs'

const IMAGE = process.env.IMAGE_STORE_KUBO_IMAGE ?? 'ipfs/kubo:latest'

let emulator: RunningEmulator | undefined
const api = () => `http://127.0.0.1:${(emulator as RunningEmulator).ports[5001]}`
const gateway = () => `http://127.0.0.1:${(emulator as RunningEmulator).ports[8080]}/ipfs/`

beforeAll(async () => {
  if (!emulatorsEnabled) return
  emulator = await startEmulator({
    image: IMAGE,
    containerPorts: [5001, 8080],
    command: ['daemon', '--offline'],
    isReady: async (ports) => (await fetch(`http://127.0.0.1:${ports[5001]}/api/v0/version`, { method: 'POST' })).ok,
  })
}, 180_000)

afterAll(async () => {
  await emulator?.stop()
})

const build = () => {
  const index = createMemoryCidIndex()
  const store = createIpfsBlobStore({
    pinning: createPinningClient({ flavor: 'kubo', apiUrl: api() }),
    gateways: [gateway()],
    index,
    retries: 0,
  })
  return { index, store }
}

describeBlobStoreContract(
  'IPFS against Kubo',
  async () => ({
    store: build().store,
    clock: Date.now,
    advanceClock: () => pause(30),
  }),
  { skipReason: emulatorsEnabled ? undefined : EMULATORS_SKIP_REASON, timeoutMs: 60_000 },
)

describe.skipIf(!emulatorsEnabled)('IPFS against Kubo: more than the contract', () => {
  it('records a CIDv1 that is not the sha256, pins it, and serves exactly the bytes through the gateway', async () => {
    const { index, store } = build()
    const bytes = Buffer.from('pinned in a real node')

    const { sha256 } = await store.put(bytes)

    const record = index.records.get(sha256)
    expect(record?.cid).toMatch(/^bafk/)
    expect(record?.cid).not.toContain(sha256)
    const pins = (await (await fetch(`${api()}/api/v0/pin/ls?type=recursive`, { method: 'POST' })).json()) as {
      Keys: Record<string, unknown>
    }
    expect(Object.keys(pins.Keys)).toContain(record?.cid)
    const served = Buffer.from(await (await fetch(`${gateway()}${record?.cid}`)).arrayBuffer())
    expect(hashBytes(served)).toBe(sha256)
  })

  it('unpins on delete', async () => {
    const { index, store } = build()
    const { sha256 } = await store.put(Buffer.from('to be unpinned'))
    const cid = index.records.get(sha256)?.cid as string

    await store.delete(sha256)

    const pins = (await (await fetch(`${api()}/api/v0/pin/ls?type=recursive`, { method: 'POST' })).json()) as {
      Keys: Record<string, unknown>
    }
    expect(Object.keys(pins.Keys)).not.toContain(cid)
  })
})
