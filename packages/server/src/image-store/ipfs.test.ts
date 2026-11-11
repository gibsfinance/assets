import { describe, expect, it, vi } from 'vitest'
import { describeBlobStoreContract } from './__testing__/blob-store-contract'
import { createFakeClock } from './__testing__/fake-clock'
import { createFakeIpfs, type FakeIpfsOptions } from './__testing__/fake-ipfs'
import { createMemoryCidIndex } from './__testing__/memory-cid-index'
import { ImageStoreConfigurationError } from './configuration-error'
import { hashBytes } from './hash'
import { BlobStoreError } from './http'
import {
  createIpfsBlobStore,
  createPinningClient,
  IPFS_CHUNK_SIZE,
  IPFS_PROVIDER_NAMES,
  IPFS_PROVIDERS,
  type PinningFlavor,
} from './ipfs'

vi.mock('../logger', () => ({ log: vi.fn() }))

const KUBO = 'https://kubo.example.test'
const PINATA = 'https://pinata.example.test'
const GATEWAYS = ['https://gateway-one.example.test/ipfs/', 'https://gateway-two.example.test/ipfs']
const noSleep = async () => undefined

const build = (settings: { flavor?: PinningFlavor; token?: string; retries?: number; gateways?: string[] } = {}) => {
  const flavor = settings.flavor ?? 'kubo'
  const clock = createFakeClock()
  const fakeOptions: FakeIpfsOptions = { kuboApi: KUBO, pinataApi: PINATA, token: settings.token }
  const service = createFakeIpfs(fakeOptions)
  const environment = { fetch: service.fetch, now: clock.now, sleep: noSleep, retries: settings.retries }
  const index = createMemoryCidIndex()
  const pinning = createPinningClient({
    ...environment,
    flavor,
    apiUrl: flavor === 'kubo' ? `${KUBO}/` : PINATA,
    token: settings.token,
  })
  const store = createIpfsBlobStore({ ...environment, pinning, index, gateways: settings.gateways ?? GATEWAYS })
  return { clock, service, index, pinning, store, environment }
}

for (const flavor of ['kubo', 'pinata'] as const) {
  describeBlobStoreContract(`IPFS over a fake pinning service, ${flavor} requests`, async () => {
    const { clock, store } = build({ flavor, token: 'secret-token' })
    return { store, clock: clock.now, advanceClock: async () => clock.advance(60_000) }
  })
}

describe('IPFS writes', () => {
  it.each(['kubo', 'pinata'] as const)(
    'adds bytes through the %s API and records the CID the service returned',
    async (flavor) => {
      const { service, index, store, clock } = build({ flavor })
      const bytes = Buffer.from('pin me')

      const { sha256 } = await store.put(bytes)

      expect(service.pins.get(service.cidOf(bytes))).toEqual(bytes)
      expect(index.records.get(sha256)).toEqual({
        sha256,
        cid: service.cidOf(bytes),
        byteSize: bytes.length,
        modifiedAtMs: clock.now(),
      })
      expect(service.cidOf(bytes)).not.toBe(sha256)
    },
  )

  it('asks for CIDv1 with raw leaves and 1 MiB blocks, so a small image is one block', async () => {
    const { service, store } = build()
    await store.put(Buffer.from('x'))

    const add = service.requests.find((request) => request.includes('/api/v0/add')) as string
    const query = new URL(add.split(' ')[1]).searchParams
    expect([...query.entries()]).toEqual([
      ['cid-version', '1'],
      ['raw-leaves', 'true'],
      ['pin', 'true'],
      ['chunker', `size-${IPFS_CHUNK_SIZE}`],
    ])
  })

  it('does not add bytes it already has: it only renews the time in the index', async () => {
    const { service, index, store, clock } = build()
    const bytes = Buffer.from('already pinned')
    const { sha256 } = await store.put(bytes)
    clock.advance(60_000)
    service.requests.length = 0

    await store.put(bytes)

    expect(service.requests).toEqual([])
    expect(index.records.get(sha256)?.modifiedAtMs).toBe(clock.now())
  })

  it('adds the bytes again when the index holds a different length for the digest', async () => {
    const { service, index, store } = build()
    const bytes = Buffer.from('truth')
    index.records.set(hashBytes(bytes), { sha256: hashBytes(bytes), cid: 'stale', byteSize: 99, modifiedAtMs: 0 })

    await store.put(bytes)

    expect(index.records.get(hashBytes(bytes))?.cid).toBe(service.cidOf(bytes))
  })

  it.each(['kubo', 'pinata'] as const)(
    'stops with an error when the %s service answers an add without a CID',
    async (flavor) => {
      const { service, store } = build({ flavor, retries: 0 })
      service.answerNextAddEmpty()

      await expect(store.put(Buffer.from('x'))).rejects.toThrow(/without a content identifier/)
    },
  )

  it.each(['kubo', 'pinata'] as const)('stops with an error when the %s service refuses an add', async (flavor) => {
    const { service, store, index } = build({ flavor, retries: 0 })
    service.failNext(500)

    await expect(store.put(Buffer.from('x'))).rejects.toBeInstanceOf(BlobStoreError)
    expect(index.records.size).toBe(0)
  })

  it('sends the bearer token, and a service that wants one refuses a request without it', async () => {
    const { environment } = build({ token: 'secret-token' })
    const service = createFakeIpfs({ kuboApi: KUBO, token: 'secret-token' })
    const withoutToken = createPinningClient({
      ...environment,
      fetch: service.fetch,
      flavor: 'kubo',
      apiUrl: KUBO,
      retries: 0,
    })
    const withToken = createPinningClient({
      ...environment,
      fetch: service.fetch,
      flavor: 'kubo',
      apiUrl: KUBO,
      token: 'secret-token',
    })

    await expect(withoutToken.add(Buffer.from('x'))).rejects.toMatchObject({ status: 401 })
    await expect(withToken.add(Buffer.from('x'))).resolves.toMatch(/^bafkfake/)
  })
})

describe('IPFS reads', () => {
  it('answers null for a digest the index does not know, without asking any gateway', async () => {
    const { service, store } = build()

    expect(await store.get(hashBytes(Buffer.from('unknown')))).toBeNull()
    expect(service.requests).toEqual([])
  })

  it('reads through the first gateway that has the content, and adds the missing slash to a gateway address', async () => {
    const { service, store } = build()
    const bytes = Buffer.from('served by two')
    const { sha256 } = await store.put(bytes)
    service.setGateway('gateway-one.example.test', 'has-nothing')
    service.requests.length = 0

    expect(await store.get(sha256)).toEqual(bytes)
    expect(service.requests).toEqual([
      `GET https://gateway-one.example.test/ipfs/${service.cidOf(bytes)}`,
      `GET https://gateway-two.example.test/ipfs/${service.cidOf(bytes)}`,
    ])
  })

  it('skips a gateway that serves other bytes than the digest names', async () => {
    const { service, store } = build()
    const bytes = Buffer.from('trust nobody')
    const { sha256 } = await store.put(bytes)
    service.setGateway('gateway-one.example.test', 'serves-wrong-bytes')

    expect(await store.get(sha256)).toEqual(bytes)
  })

  it('skips a gateway that is down', async () => {
    const { service, store } = build({ retries: 0 })
    const bytes = Buffer.from('one gateway fails')
    const { sha256 } = await store.put(bytes)
    service.setGateway('gateway-one.example.test', 'is-down')

    expect(await store.get(sha256)).toEqual(bytes)
  })

  it.each([
    ['has nothing', 'has-nothing'],
    ['serves wrong bytes', 'serves-wrong-bytes'],
    ['is down', 'is-down'],
  ] as const)('reports an error, never a missing blob, when every gateway %s', async (_label, behavior) => {
    const { service, store } = build({ retries: 0 })
    const { sha256 } = await store.put(Buffer.from('unreachable'))
    service.setGateway('gateway-one.example.test', behavior)
    service.setGateway('gateway-two.example.test', behavior)

    await expect(store.get(sha256)).rejects.toThrow(/no gateway returned the blob/)
  })

  it('refuses to start without a gateway', () => {
    const { pinning, index } = build()

    expect(() => createIpfsBlobStore({ pinning, index, gateways: [] })).toThrow(ImageStoreConfigurationError)
  })

  it('uses the global fetch and clock when none are given', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"Hash":"cid-global"}'))
    const index = createMemoryCidIndex()
    const store = createIpfsBlobStore({
      pinning: createPinningClient({ flavor: 'kubo', apiUrl: KUBO }),
      index,
      gateways: GATEWAYS,
    })

    await store.put(Buffer.from('global'))

    expect(index.records.size).toBe(1)
    expect(globalFetch).toHaveBeenCalledTimes(1)
    globalFetch.mockRestore()
  })
})

describe('IPFS deletes', () => {
  it.each(['kubo', 'pinata'] as const)('unpins through the %s API and forgets the blob', async (flavor) => {
    const { service, index, store } = build({ flavor })
    const { sha256 } = await store.put(Buffer.from('remove me'))

    expect(await store.delete(sha256)).toBe(true)

    expect(service.pins.size).toBe(0)
    expect(index.records.size).toBe(0)
  })

  it('forgets a blob that was already unpinned elsewhere', async () => {
    const { service, index, store } = build()
    const { sha256 } = await store.put(Buffer.from('gone already'))
    service.pins.clear()

    expect(await store.delete(sha256)).toBe(true)
    expect(index.records.size).toBe(0)
  })

  it('treats a pinata 404 on unpin as already unpinned', async () => {
    const { service, index, store } = build({ flavor: 'pinata' })
    const { sha256 } = await store.put(Buffer.from('gone already'))
    service.pins.clear()

    expect(await store.delete(sha256)).toBe(true)
    expect(index.records.size).toBe(0)
  })

  it('keeps the record when unpinning fails, so the delete can be tried again', async () => {
    const { service, index, store } = build({ retries: 0 })
    const { sha256 } = await store.put(Buffer.from('stubborn'))
    service.failNext(500, 1, 'disk on fire')

    await expect(store.delete(sha256)).rejects.toThrow(/ipfs unpin failed with status 500: disk on fire/)
    expect(index.records.size).toBe(1)
  })
})

describe('IPFS providers', () => {
  it('names the services the settings table promises, with the gateways the collectors already use', () => {
    expect(IPFS_PROVIDER_NAMES).toEqual(['kubo', 'filebase', 'pinata'])
    expect(IPFS_PROVIDERS.filebase).toEqual({
      flavor: 'kubo',
      defaultApiUrl: 'https://rpc.filebase.io',
      defaultGateways: ['https://ipfs.filebase.io/ipfs/'],
    })
    expect(IPFS_PROVIDERS.pinata.flavor).toBe('pinata')
    expect(IPFS_PROVIDERS.kubo.defaultApiUrl).toBeNull()
  })
})
