import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../fetch', () => harness.fetchModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import web3icons, { collect } from './web3icons'

const METADATA_URL =
  'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/common/src/metadata/networks.json'
const BRANDED_BASE = 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/networks/branded'

/** Seed an existing network the way an earlier collector run (e.g. chainlist) would have. */
const seedNetwork = (chainId: number | string, type = 'evm') => harness.dbModule.insertNetworkFromChainId(chainId, type)

describe('web3icons collector', () => {
  it('registers the provider with no token lists during discover()', async () => {
    const manifest = await web3icons.discover(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['web3icons'])
    expect(manifest).toEqual([{ providerKey: 'web3icons', lists: [] }])
  })

  it('attaches the branded icon to a network that already exists, matched by caip2id', async () => {
    await seedNetwork(324)
    harness.queueFetchResponse(METADATA_URL, {
      body: [{ id: 'zksync', caip2id: 'eip155:324', variants: ['background', 'branded', 'mono'] }],
    })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(1)
    expect(harness.state.networkImages[0]).toMatchObject({
      providerKey: 'web3icons',
      chainId: 'eip155-324',
      uri: `${BRANDED_BASE}/zksync.svg`,
      originalUri: `${BRANDED_BASE}/zksync.svg`,
    })
  })

  it('never creates a network for an entry matching none this project already holds', async () => {
    // Artwork only, never identity — the whole point of this collector. An
    // unmatched entry must be skipped, not used to conjure a new network row.
    harness.queueFetchResponse(METADATA_URL, {
      body: [{ id: 'brand-new-chain', caip2id: 'eip155:999999999', variants: ['branded'] }],
    })

    await collect(new AbortController().signal)

    expect(harness.state.networks.size).toBe(0)
    expect(harness.state.networkImages).toHaveLength(0)
  })

  it('skips an entry with no caip2id instead of matching it by name', async () => {
    // Even when a network of the same name exists, an entry with no identifier
    // must not be matched to it — matching by name is the mistake this project
    // has already been burned by.
    await seedNetwork(1)
    harness.queueFetchResponse(METADATA_URL, {
      body: [{ id: 'ethereum-classic-look-alike', name: 'Ethereum', variants: ['branded'] }],
    })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
  })

  it("does not disturb an existing network's naming — artwork only", async () => {
    const network = await seedNetwork(324)
    await harness.dbModule.setNetworkNaming({ networkId: network.networkId, name: 'zkSync Era Mainnet' })
    harness.queueFetchResponse(METADATA_URL, {
      body: [{ id: 'zksync', caip2id: 'eip155:324', variants: ['branded'] }],
    })

    await collect(new AbortController().signal)

    const stored = [...harness.state.networks.values()].find((n) => n.chainId === 'eip155-324')
    expect(stored?.name).toBe('zkSync Era Mainnet')
  })

  it('matches a non-Ethereum namespace against its own namespaced network, not an eip155 one', async () => {
    await seedNetwork('solana-5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana')
    harness.queueFetchResponse(METADATA_URL, {
      body: [{ id: 'solana', caip2id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', variants: ['branded'] }],
    })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(1)
    expect(harness.state.networkImages[0]?.chainId).toBe('solana-5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
  })

  it('does nothing when the metadata feed does not answer', async () => {
    await seedNetwork(324)
    harness.queueFetchResponse(METADATA_URL, { status: 503, ok: false })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
  })

  it('survives a metadata request that rejects outright, without throwing out of collect()', async () => {
    await seedNetwork(324)
    harness.queueFetchResponse(METADATA_URL, new Error('network error'))

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()
    expect(harness.state.networkImages).toHaveLength(0)
  })

  it('skips storing any icon once the signal is already aborted', async () => {
    await seedNetwork(324)
    harness.queueFetchResponse(METADATA_URL, {
      body: [{ id: 'zksync', caip2id: 'eip155:324', variants: ['branded'] }],
    })
    const controller = new AbortController()
    controller.abort()

    await collect(controller.signal)

    expect(harness.state.networkImages).toHaveLength(0)
  })

  it('handles a mix of matched, unmatched, and identifier-less entries in one run', async () => {
    await seedNetwork(324)
    await seedNetwork(1)
    harness.queueFetchResponse(METADATA_URL, {
      body: [
        { id: 'zksync', caip2id: 'eip155:324', variants: ['branded'] },
        { id: 'ethereum', caip2id: 'eip155:1', variants: ['branded'] },
        { id: 'no-such-chain', caip2id: 'eip155:404404404', variants: ['branded'] },
        { id: 'nameless-only', name: 'Nothing To Go On', variants: ['branded'] },
      ],
    })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(2)
    const chainIds = harness.state.networkImages.map((image) => image.chainId).sort()
    expect(chainIds).toEqual(['eip155-1', 'eip155-324'])
  })
})
