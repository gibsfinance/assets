import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, createLogAppMock, renderSql } from './__testing__/drizzle-harness'

const harness = createDrizzleHarness()
vi.mock('./drizzle', () => ({ getDrizzle: () => harness.db }))
vi.mock('../log/App', () => createLogAppMock())

const { detectImageExt, sanitizeImage, checkShouldSave, fetchMock, fsPromises } = vi.hoisted(() => ({
  detectImageExt: vi.fn<(image: Buffer, providedExt: string) => Promise<string | null>>(),
  sanitizeImage: vi.fn<(image: Buffer, ext: string) => Promise<Buffer>>(),
  checkShouldSave: vi.fn<(providerKey: string) => boolean>(),
  fetchMock: vi.fn(),
  fsPromises: {
    rm: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
  },
}))
vi.mock('../image-format', () => ({ detectImageExt }))
vi.mock('../sanitize', () => ({ sanitizeImage }))
vi.mock('../args', () => ({ checkShouldSave }))
vi.mock('../fetch', () => ({ fetch: fetchMock }))
vi.mock('fs', () => ({ promises: fsPromises }))

// Static imports so the module graph loads once during file setup rather than
// inside a test's own timeout budget — see index.order.test.ts.
import {
  insertImage,
  fetchImage,
  resolveImage,
  getImageFromLink,
  getFreshImageFromLink,
  getImageByAddress,
  insertHeaderLink,
  fetchImageAndStoreForList,
  fetchImageAndStoreForNetwork,
  fetchAndInsertHeader,
  batchFetchImagesForTokens,
  fetchImageAndStoreForToken,
} from './index'
import * as s from './schema'

beforeEach(() => {
  harness.reset()
  detectImageExt.mockReset()
  sanitizeImage.mockReset()
  checkShouldSave.mockReset().mockReturnValue(true)
  fetchMock.mockReset()
  fsPromises.rm.mockReset().mockResolvedValue(undefined)
  fsPromises.mkdir.mockReset().mockResolvedValue(undefined)
  fsPromises.writeFile.mockReset().mockResolvedValue(undefined)
  fsPromises.readFile.mockReset()
})

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array.from({ length: 200 }, () => 0)])

// ---------------------------------------------------------------------------
// insertImage
// ---------------------------------------------------------------------------

describe('insertImage', () => {
  it('rejects and records the miss when the extension cannot be detected, without inserting anything', async () => {
    detectImageExt.mockResolvedValue(null)

    const result = await insertImage({
      providerKey: 'trustwallet',
      originalUri: 'https://x/icon',
      image: PNG_BYTES,
      listId: null,
    })

    expect(result).toBeNull()
    expect(fsPromises.writeFile).toHaveBeenCalled()
    expect(harness.queries).toHaveLength(0)
  })

  it('rejects a raster image below the minimum byte size, treating it as a placeholder', async () => {
    detectImageExt.mockResolvedValue('.png')
    const tiny = Buffer.from([1, 2, 3])

    const result = await insertImage({
      providerKey: 'coingecko',
      originalUri: 'https://x/thumb.png',
      image: tiny,
      listId: null,
    })

    // CoinGecko-style thumbnail placeholders are real, decodable PNGs, just too
    // small to be a usable logo — size is the only signal available to reject them.
    expect(result).toBeNull()
    expect(harness.queries).toHaveLength(0)
  })

  it('does not apply the minimum-size rule to svg images', async () => {
    detectImageExt.mockResolvedValue('.svg')
    sanitizeImage.mockResolvedValue(Buffer.from('<svg/>'))
    harness.queueResult([{ imageHash: 'hash-1' }])
    harness.queueResult([{ uri: 'https://x/icon.svg' }])
    const tiny = Buffer.from('<svg/>')

    const result = await insertImage({
      providerKey: 'trustwallet',
      originalUri: 'https://x/icon.svg',
      image: tiny,
      listId: null,
    })

    expect(result).not.toBeNull()
  })

  it('stores real content in save mode and an empty buffer in link mode', async () => {
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    checkShouldSave.mockReturnValue(true)
    harness.queueResult([{ imageHash: 'hash-1', content: Buffer.from('sanitized'), mode: 'save' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }])

    await insertImage({ providerKey: 'trustwallet', originalUri: 'https://x/icon.png', image: PNG_BYTES, listId: null })

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const row = insertQuery?.steps.find((step) => step.method === 'values')?.args[0] as {
      content: Buffer
      mode: string
    }
    expect(row.mode).toBe('save')
    expect(row.content.length).toBeGreaterThan(0)

    harness.reset()
    checkShouldSave.mockReturnValue(false)
    harness.queueResult([{ imageHash: 'hash-2', content: Buffer.from([]), mode: 'link' }])
    harness.queueResult([{ uri: 'https://x/icon2.png' }])

    await insertImage({ providerKey: 'pumptires', originalUri: 'https://x/icon2.png', image: PNG_BYTES, listId: null })

    const secondInsert = harness.queries.find((query) => query.root === 'insert')
    const secondRow = secondInsert?.steps.find((step) => step.method === 'values')?.args[0] as {
      content: Buffer
      mode: string
    }
    // Link mode never stores bytes — the server redirects to the source uri
    // instead of serving untrusted provider content directly.
    expect(secondRow.mode).toBe('link')
    expect(secondRow.content).toEqual(Buffer.from([]))
  })

  it('refreshes content/mode/uri on a re-collected image, keyed on the conflicting image hash', async () => {
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-1' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }])

    await insertImage({ providerKey: 'trustwallet', originalUri: 'https://x/icon.png', image: PNG_BYTES, listId: null })

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const conflictStep = insertQuery?.steps.find((step) => step.method === 'onConflictDoUpdate')
    const conflictArgs = conflictStep?.args[0] as { target: unknown; set: Record<string, unknown> }
    expect(conflictArgs.target).toBe(s.image.imageHash)
    expect(Object.keys(conflictArgs.set).sort()).toEqual(['content', 'mode', 'uri'])
  })

  it('skips writing a miss record entirely under PREVENT_WRITE_MISSING', async () => {
    detectImageExt.mockResolvedValue(null)
    process.env.PREVENT_WRITE_MISSING = '1'
    try {
      await insertImage({ providerKey: 'trustwallet', originalUri: 'https://x/icon', image: PNG_BYTES, listId: null })
    } finally {
      delete process.env.PREVENT_WRITE_MISSING
    }

    // A test run must not litter the real filesystem with miss records — this
    // flag is how CI/tests opt out of that side effect.
    expect(fsPromises.mkdir).not.toHaveBeenCalled()
    expect(fsPromises.writeFile).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// fetchImage
// ---------------------------------------------------------------------------

describe('fetchImage', () => {
  it('passes a Buffer input straight through without touching the network or filesystem', async () => {
    const buffer = Buffer.from('raw bytes')
    const result = await fetchImage(buffer, undefined, 'trustwallet')
    expect(result).toBe(buffer)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fsPromises.readFile).not.toHaveBeenCalled()
  })

  it('returns null for an empty string url', async () => {
    const result = await fetchImage('', undefined, 'trustwallet')
    expect(result).toBeNull()
  })

  it('reads a leading-slash url from the local filesystem', async () => {
    fsPromises.readFile.mockResolvedValue(Buffer.from('local file bytes'))
    const result = await fetchImage('/local/path/icon.png', undefined, 'trustwallet')
    expect(result).toEqual(Buffer.from('local file bytes'))
    expect(fsPromises.readFile).toHaveBeenCalledWith('/local/path/icon.png')
  })

  it('swallows a local read failure and returns null rather than throwing', async () => {
    fsPromises.readFile.mockRejectedValue(new Error('ENOENT'))
    const result = await fetchImage('/local/missing.png', undefined, 'trustwallet')
    expect(result).toBeNull()
  })

  it('swallows an abort/timeout error and returns null', async () => {
    fetchMock.mockRejectedValue(new Error('The operation was aborted due to TimeoutError'))
    const result = await fetchImage('https://example.com/icon.png', undefined, 'trustwallet')
    expect(result).toBeNull()
  })

  it('swallows an invalid-URL error and returns null', async () => {
    fetchMock.mockRejectedValue(new Error('Invalid URL'))
    const result = await fetchImage('not a real url', undefined, 'trustwallet')
    expect(result).toBeNull()
  })

  it('swallows any other fetch failure and returns null', async () => {
    fetchMock.mockRejectedValue(new Error('connection reset'))
    const result = await fetchImage('https://example.com/icon.png', undefined, 'trustwallet')
    expect(result).toBeNull()
  })

  it('combines a caller-supplied abort signal with the internal timeout signal', async () => {
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    const controller = new AbortController()

    await fetchImage('https://example.com/icon.png', controller.signal, 'trustwallet')

    // Without combining both, either the caller's own cancellation (e.g. the
    // HTTP request that triggered this fetch was itself aborted) or the
    // internal 3-second timeout would be silently ignored.
    const [, init] = fetchMock.mock.calls[0] as [string, { signal: AbortSignal }]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

// ---------------------------------------------------------------------------
// resolveImage
// ---------------------------------------------------------------------------

describe('resolveImage', () => {
  it('returns null when the fetch itself fails, without attempting extension detection', async () => {
    fetchMock.mockRejectedValue(new Error('connection reset'))
    const result = await resolveImage('https://example.com/icon.png', undefined, 'trustwallet')
    expect(result).toBeNull()
    expect(detectImageExt).not.toHaveBeenCalled()
  })

  it('returns null when the fetched bytes have no detectable extension', async () => {
    const buffer = Buffer.from('not an image')
    const result = await resolveImage(buffer, undefined, 'trustwallet', '0xabc')
    detectImageExt.mockResolvedValue(null)
    const resolved = await resolveImage(buffer, undefined, 'trustwallet', '0xabc')
    expect(resolved).toBeNull()
    void result
  })

  it('labels a buffer input with a synthetic originalUri built from provider and address', async () => {
    detectImageExt.mockResolvedValue('.png')
    const buffer = Buffer.from('image bytes')

    const resolved = await resolveImage(buffer, undefined, 'trustwallet', '0xabc')

    expect(resolved).toEqual({ buffer, ext: '.png', originalUri: 'buffer:trustwallet:0xabc' })
  })
})

// ---------------------------------------------------------------------------
// getImageFromLink / getFreshImageFromLink
// ---------------------------------------------------------------------------

describe('getImageFromLink', () => {
  it('returns null when the link itself is missing, without querying the image table', async () => {
    harness.queueResult([])
    const result = await getImageFromLink('https://x/icon.png')
    expect(result).toBeNull()
    expect(harness.queries).toHaveLength(1)
  })

  it('returns null when the link exists but its image row is gone', async () => {
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }])
    harness.queueResult([])
    const result = await getImageFromLink('https://x/icon.png')
    expect(result).toBeNull()
  })

  it('returns both rows when the link resolves to a real image', async () => {
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }])
    harness.queueResult([{ imageHash: 'hash-1' }])
    const result = await getImageFromLink('https://x/icon.png')
    expect(result).toEqual({ link: { uri: 'https://x/icon.png', imageHash: 'hash-1' }, image: { imageHash: 'hash-1' } })
  })
})

describe('getFreshImageFromLink', () => {
  it('returns null when no link is fresher than the cutoff', async () => {
    harness.queueResult([])
    const result = await getFreshImageFromLink('https://x/icon.png', 1000)
    expect(result).toBeNull()
  })

  it('returns null when the fresh link exists but its image row is gone', async () => {
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }])
    harness.queueResult([])
    const result = await getFreshImageFromLink('https://x/icon.png', 1000)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getImageByAddress
// ---------------------------------------------------------------------------

describe('getImageByAddress', () => {
  it('returns null immediately when the chain has no stored network', async () => {
    harness.queueResult([])
    const result = await getImageByAddress({ chainId: 999999, address: '0xabc' })
    expect(result).toBeNull()
    expect(harness.queries).toHaveLength(1)
  })

  it('returns null when the network exists but the token does not', async () => {
    harness.queueResult([{ networkId: 'network-1' }])
    harness.queueResult([])
    const result = await getImageByAddress({ chainId: 1, address: '0xabc' })
    expect(result).toBeNull()
  })

  it('adds a providerId filter only when one is supplied', async () => {
    harness.queueResult([{ networkId: 'network-1' }])
    harness.queueResult([{ tokenId: 'token-1' }])
    harness.queueResult([{ list_token: { imageHash: 'hash-1' }, list: { providerId: 'provider-1' } }])

    const result = await getImageByAddress({ chainId: 1, address: '0xabc', providerId: 'provider-1' })

    const listTokenQuery = harness.queries[2]
    const whereStep = listTokenQuery.steps.find((step) => step.method === 'where')
    const rendered = renderSql(whereStep?.args[0])
    // Without the providerId filter, a request scoped to one provider could
    // silently surface a different provider's image for the same token.
    expect(rendered).toContain('list"."provider_id"')
    expect(result?.listTokens).toEqual({ imageHash: 'hash-1', providerId: 'provider-1' })
  })

  it('returns the token with listTokens undefined when it has no list membership at all', async () => {
    harness.queueResult([{ networkId: 'network-1' }])
    harness.queueResult([{ tokenId: 'token-1' }])
    harness.queueResult([]) // no list_token/list join row

    const result = await getImageByAddress({ chainId: 1, address: '0xabc' })

    expect(result).toEqual({ token: { tokenId: 'token-1' }, listTokens: undefined })
  })
})

// ---------------------------------------------------------------------------
// insertHeaderLink
// ---------------------------------------------------------------------------

describe('insertHeaderLink', () => {
  it('conflicts on listTokenId, refreshing it to itself so RETURNING yields the existing row', async () => {
    harness.queueResult([{ listTokenId: 'lt-1', imageHash: 'hash-1' }])

    await insertHeaderLink({ listTokenId: 'lt-1', imageHash: 'hash-1' })

    const insertQuery = harness.queries[0]
    const conflictStep = insertQuery.steps.find((step) => step.method === 'onConflictDoUpdate')
    const conflictArgs = conflictStep?.args[0] as { target: unknown }
    expect(conflictArgs.target).toBe(s.headerLink.listTokenId)
  })
})

// ---------------------------------------------------------------------------
// fetchImageAndStoreForList
// ---------------------------------------------------------------------------

describe('fetchImageAndStoreForList', () => {
  it('reuses a fresh cached image when it already matches the list image hash', async () => {
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }]) // link lookup
    harness.queueResult([{ imageHash: 'hash-1' }]) // image lookup
    harness.queueResult([{ listId: 'list-1', imageHash: 'hash-1' }]) // getListFromId

    const result = await fetchImageAndStoreForList({
      listId: 'list-1',
      uri: 'https://x/icon.png',
      originalUri: null,
      providerKey: 'trustwallet',
    })

    // No re-fetch and no image insert — this is the entire point of the
    // freshness cache: repeated collection runs must not re-download unchanged icons.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(harness.queries.filter((query) => query.root === 'insert')).toHaveLength(0)
    expect(result).toMatchObject({ list: { listId: 'list-1', imageHash: 'hash-1' } })
  })

  it('re-fetches when the fresh cache exists but the list is pointing at a different image', async () => {
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-old' }])
    harness.queueResult([{ imageHash: 'hash-old' }])
    harness.queueResult([{ listId: 'list-1', imageHash: 'hash-different' }]) // getListFromId — mismatch
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }]) // insertImage: image insert
    harness.queueResult([{ uri: 'https://x/icon.png' }]) // insertImage: link insert
    harness.queueResult([{ listId: 'list-1', imageHash: 'hash-new' }]) // list update

    const result = await fetchImageAndStoreForList({
      listId: 'list-1',
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'trustwallet',
    })

    expect(fetchMock).toHaveBeenCalled()
    expect(result?.list).toMatchObject({ imageHash: 'hash-new' })
  })

  it('returns only the list row when there is no uri to fetch', async () => {
    harness.queueResult([{ listId: 'list-1' }]) // getListFromId

    const result = await fetchImageAndStoreForList({
      listId: 'list-1',
      uri: null,
      originalUri: null,
      providerKey: 'trustwallet',
    })

    expect(result).toEqual({ list: { listId: 'list-1' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('records a miss and returns undefined when the fetch fails', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockRejectedValue(new Error('connection reset'))

    const result = await fetchImageAndStoreForList({
      listId: 'list-1',
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'trustwallet',
    })

    expect(result).toBeUndefined()
    expect(fsPromises.writeFile).toHaveBeenCalled()
    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(0)
  })

  it('updates the list image hash on a successful fetch and insert', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }])
    harness.queueResult([{ listId: 'list-1', imageHash: 'hash-new' }])

    const result = await fetchImageAndStoreForList({
      listId: 'list-1',
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'trustwallet',
    })

    const updateQuery = harness.queries.find((query) => query.root === 'update')
    const setStep = updateQuery?.steps.find((step) => step.method === 'set')
    expect(setStep?.args[0]).toEqual({ imageHash: 'hash-new' })
    expect(result?.list).toMatchObject({ imageHash: 'hash-new' })
  })

  it('returns undefined without updating the list when insertImage rejects the fetched bytes', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue(null) // insertImage rejects: no detectable extension

    const result = await fetchImageAndStoreForList({
      listId: 'list-1',
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'trustwallet',
    })

    expect(result).toBeUndefined()
    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// fetchImageAndStoreForNetwork
// ---------------------------------------------------------------------------

describe('fetchImageAndStoreForNetwork', () => {
  const network = { networkId: 'network-1', chainId: 'eip155-1' } as never

  it('skips the download and the transaction when the image is already fresh', async () => {
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }])
    harness.queueResult([{ imageHash: 'hash-1' }])
    // The slot is still contested — see the tests below — so the incumbent lookup
    // happens either way. It already holds exactly what this collector would write.
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-1', imageProviderKey: 'chainlist' }])

    const result = await fetchImageAndStoreForNetwork({
      network,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'chainlist',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(false)
    // Nothing to change, so nothing is written. Every collector revisits every network
    // it knows on every run; an unconditional update here is thousands of no-op writes.
    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(0)
    expect(result?.network).toMatchObject({ imageHash: 'hash-1' })
  })

  it('still contests the network slot when the image is already fresh', async () => {
    // The reason the ranking above was inert in production. Images stay fresh for a
    // week (IMAGE_MAX_AGE_HOURS, default 168) and collection runs every six hours, so
    // on all but one run in twenty-eight every collector takes the fresh path. When
    // that path returned without contesting the slot, the comparison was unreachable:
    // whichever collector won the very first race held the chain until its logo
    // expired. Staging and production diverged on sixty-one chains this way, with
    // chainlist — the deliberate last resort — holding Ethereum on one of them.
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-curated' }])
    harness.queueResult([{ imageHash: 'hash-curated' }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-fallback', imageProviderKey: 'chainlist' }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-curated' }])

    const result = await fetchImageAndStoreForNetwork({
      network,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'smoldapp',
    })

    const [update] = harness.queries.filter((query) => query.root === 'update')
    const written = update.steps.find((step) => step.method === 'set')?.args[0] as Record<string, unknown>
    expect(written).toEqual({ imageHash: 'hash-curated', imageProviderKey: 'smoldapp' })
    expect(result?.network).toMatchObject({ imageHash: 'hash-curated' })
  })

  it('yields the slot on the fresh path when the incumbent outranks the caller', async () => {
    // The mirror of the case above: contesting the slot must not mean taking it.
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-fallback' }])
    harness.queueResult([{ imageHash: 'hash-fallback' }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-curated', imageProviderKey: 'smoldapp' }])

    const result = await fetchImageAndStoreForNetwork({
      network,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'chainlist',
    })

    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(0)
    expect(result?.network).toMatchObject({ imageHash: 'hash-curated', imageProviderKey: 'smoldapp' })
  })

  it('stores a fetched image and the network row inside a single transaction', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }])
    // The incumbent lookup: this network holds no icon yet, so the write proceeds.
    harness.queueResult([{ networkId: 'network-1', imageHash: null, imageProviderKey: null }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-new' }])

    const result = await fetchImageAndStoreForNetwork({
      network,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'chainlist',
    })

    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(true)
    expect(result?.network).toMatchObject({ imageHash: 'hash-new' })
  })

  it('leaves the network icon alone when a higher-priority collector already claimed it', async () => {
    // The write used to be unconditional, so the last of the six collectors that write
    // network icons took the slot regardless of rank. chainlist is deliberately last in
    // the registry — "kept last so any chain-specific logo outranks it" — and under
    // last-write-wins it outranked everything instead. That is why two deployments of
    // the same code served different icons for the same chain: the winner came down to
    // collection order rather than the priority the registry declares.
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-curated', imageProviderKey: 'smoldapp' }])

    const result = await fetchImageAndStoreForNetwork({
      network,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'chainlist',
    })

    // No update issued at all, and the caller still gets the network row back.
    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(0)
    expect(result?.network).toMatchObject({ imageHash: 'hash-curated' })
    // The bytes are still stored — losing the network slot is no reason to discard an
    // image some list_token may point at.
    expect(harness.queries.filter((query) => query.root === 'insert').length).toBeGreaterThan(0)
  })

  it('takes the network icon when the incumbent came from a lower-priority collector', async () => {
    // The mirror of the case above, and the one that repairs a chain a fallback already
    // claimed: a curated source has to be able to displace chainlist.
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-fallback', imageProviderKey: 'chainlist' }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-new' }])

    const result = await fetchImageAndStoreForNetwork({
      network,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'smoldapp',
    })

    const [update] = harness.queries.filter((query) => query.root === 'update')
    const written = update.steps.find((step) => step.method === 'set')?.args[0] as Record<string, unknown>
    // Both columns move together. Writing the hash without the key would leave the next
    // run comparing against stale provenance and reopen the same race.
    expect(written).toEqual({ imageHash: 'hash-new', imageProviderKey: 'smoldapp' })
    expect(result?.network).toMatchObject({ imageHash: 'hash-new' })
  })

  it('claims a network icon of unknown provenance rather than yielding to it', async () => {
    // Every network row written before provenance was recorded carries a null key.
    // Treating unknown as lowest priority is what lets the next collection run settle
    // those rows onto a real source instead of freezing the accidental winner.
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-legacy', imageProviderKey: null }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-new' }])

    const result = await fetchImageAndStoreForNetwork({
      network,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      // Even the lowest-ranked collector outranks an icon nobody can attribute.
      providerKey: 'chainlist',
    })

    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(1)
    expect(result?.network).toMatchObject({ imageHash: 'hash-new' })
  })

  it('skips the freshness cache check entirely when uri is a Buffer rather than a string', async () => {
    const buffer = PNG_BYTES
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'buffer:chainlist:chain-id:eip155-1' }])
    harness.queueResult([{ networkId: 'network-1', imageHash: null, imageProviderKey: null }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-new' }])

    const result = await fetchImageAndStoreForNetwork({
      network,
      uri: buffer,
      originalUri: 'buffer:chainlist:chain-id:eip155-1',
      providerKey: 'chainlist',
    })

    // A Buffer source (already-fetched bytes) has no link/url to look up a
    // fresh cache entry by — the freshness check only makes sense for a uri.
    expect(fetchMock).not.toHaveBeenCalled()
    // The only select is the incumbent-icon lookup the write path does inside its
    // transaction. Naming the table rather than counting keeps this pinned to the
    // absence of the `link` freshness lookup, which is what the case is about.
    const selectedTables = harness.queries
      .filter((query) => query.root === 'select')
      .map((query) => query.steps.find((step) => step.method === 'from')?.args[0])
    expect(selectedTables).toEqual([s.network])
    expect(result?.network).toMatchObject({ imageHash: 'hash-new' })
  })

  it('derives originalUri from uri when the caller passes an empty originalUri', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses, keyed on uri
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }]) // insertImage's link insert
    harness.queueResult([{ networkId: 'network-1', imageHash: null, imageProviderKey: null }])
    harness.queueResult([{ networkId: 'network-1', imageHash: 'hash-new' }])

    await fetchImageAndStoreForNetwork({
      network,
      uri: 'https://x/icon.png',
      originalUri: '',
      providerKey: 'chainlist',
    })

    const linkInsert = harness.queries.filter((query) => query.root === 'insert')[1]
    const row = linkInsert.steps.find((step) => step.method === 'values')?.args[0] as { uri: string }
    // Without the fallback, insertImage would receive an empty originalUri and
    // the stored link/miss-record would carry no usable source location.
    expect(row.uri).toBe('https://x/icon.png')
  })

  it('records a miss and returns undefined when the fetch fails, without opening a transaction', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockRejectedValue(new Error('connection reset'))

    const result = await fetchImageAndStoreForNetwork({
      network,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'chainlist',
    })

    expect(result).toBeUndefined()
    expect(fsPromises.writeFile).toHaveBeenCalled()
    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(false)
  })

  it('resolves the transaction to undefined when insertImage rejects the fetched bytes', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue(null) // insertImage rejects: no detectable extension

    const result = await fetchImageAndStoreForNetwork({
      network,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      providerKey: 'chainlist',
    })

    expect(result).toBeUndefined()
    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(true)
    expect(harness.queries.some((query) => query.root === 'update')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// fetchAndInsertHeader
// ---------------------------------------------------------------------------

describe('fetchAndInsertHeader', () => {
  it('does nothing when a fresh cached header image already exists', async () => {
    harness.queueResult([{ uri: 'https://x/header.png', imageHash: 'hash-1' }])
    harness.queueResult([{ imageHash: 'hash-1' }])

    await fetchAndInsertHeader({
      providerKey: 'trustwallet',
      listTokenId: 'lt-1',
      uri: 'https://x/header.png',
      originalUri: 'https://x/header.png',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(false)
  })

  it('inserts the header image and link inside a transaction on a successful fetch', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/header.png' }])
    harness.queueResult([{ listTokenId: 'lt-1', imageHash: 'hash-new' }])

    await fetchAndInsertHeader({
      providerKey: 'trustwallet',
      listTokenId: 'lt-1',
      uri: 'https://x/header.png',
      originalUri: 'https://x/header.png',
    })

    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(true)
    const headerInsert = harness.queries[harness.queries.length - 1]
    const row = headerInsert.steps.find((step) => step.method === 'values')?.args[0] as { imageHash: string }
    expect(row.imageHash).toBe('hash-new')
  })

  it('skips the freshness cache check entirely when uri is a Buffer rather than a string', async () => {
    const buffer = PNG_BYTES
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'buffer:trustwallet:lt-1' }])
    harness.queueResult([{ listTokenId: 'lt-1', imageHash: 'hash-new' }])

    await fetchAndInsertHeader({
      providerKey: 'trustwallet',
      listTokenId: 'lt-1',
      uri: buffer,
      originalUri: 'buffer:trustwallet:lt-1',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(harness.queries.filter((query) => query.root === 'select')).toHaveLength(0)
    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(true)
  })

  it('does nothing, without opening a transaction, when the fetch itself fails', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockRejectedValue(new Error('connection reset'))

    await fetchAndInsertHeader({
      providerKey: 'trustwallet',
      listTokenId: 'lt-1',
      uri: 'https://x/header.png',
      originalUri: 'https://x/header.png',
    })

    // Unlike the list/network/token variants, a failed header fetch does not
    // record a miss file — headers are a lower-priority secondary asset.
    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(false)
  })

  it('inserts nothing when insertImage rejects the fetched bytes inside the transaction', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue(null) // insertImage rejects: no detectable extension

    await fetchAndInsertHeader({
      providerKey: 'trustwallet',
      listTokenId: 'lt-1',
      uri: 'https://x/header.png',
      originalUri: 'https://x/header.png',
    })

    // detectImageExt rejects the bytes before insertImage ever queries the
    // database, so the transaction runs but never reaches insertHeaderLink.
    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(true)
    expect(harness.queries.filter((query) => query.root === 'insert')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// batchFetchImagesForTokens
// ---------------------------------------------------------------------------

describe('batchFetchImagesForTokens', () => {
  it('short-circuits on an empty batch without issuing any query', async () => {
    const result = await batchFetchImagesForTokens([])
    expect(result).toEqual([])
    expect(harness.queries).toHaveLength(0)
  })

  it('skips an item with no uri, leaving its result null, without touching the database', async () => {
    const result = await batchFetchImagesForTokens([
      { listTokenId: 'lt-1', uri: null, originalUri: null, providerKey: 'trustwallet' },
    ])

    // Deliberately null rather than a { success: false } shape — a caller has
    // to treat "nothing to fetch" and "fetch attempted and failed" the same
    // way (neither updates the listToken), so both collapse to a falsy result.
    expect(harness.queries).toHaveLength(0)
    expect(result[0].result).toBeNull()
  })

  it('fetches and links an image for a valid item, updating that item alone', async () => {
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }])
    harness.queueResult([{ listTokenId: 'lt-1' }]) // update .set(imageHash).where(...)

    const result = await batchFetchImagesForTokens([
      { listTokenId: 'lt-1', uri: 'https://x/icon.png', originalUri: 'https://x/icon.png', providerKey: 'trustwallet' },
    ])

    const updateQuery = harness.queries.find((query) => query.root === 'update')
    const whereStep = updateQuery?.steps.find((step) => step.method === 'where')
    expect(renderSql(whereStep?.args[0])).toContain('list_token"."list_token_id"')
    expect(result[0].result).toMatchObject({ listTokenId: 'lt-1', success: true })
  })

  it('leaves one failed fetch as a null result without aborting the rest of the batch', async () => {
    // fetchImage swallows its own network errors and resolves null rather than
    // throwing, so a failed fetch inside the batch surfaces as a null result,
    // not a caught exception — this pins that down instead of assuming a throw.
    fetchMock.mockRejectedValueOnce(new Error('connection reset'))
    fetchMock.mockResolvedValueOnce(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/icon-2.png' }])
    harness.queueResult([{ listTokenId: 'lt-2' }])

    const result = await batchFetchImagesForTokens([
      {
        listTokenId: 'lt-1',
        uri: 'https://x/icon-1.png',
        originalUri: 'https://x/icon-1.png',
        providerKey: 'trustwallet',
      },
      {
        listTokenId: 'lt-2',
        uri: 'https://x/icon-2.png',
        originalUri: 'https://x/icon-2.png',
        providerKey: 'trustwallet',
      },
    ])

    expect(result[0].result).toBeNull()
    expect(result[1].result).toMatchObject({ success: true, listTokenId: 'lt-2' })
  })

  it('reports success:false with a message when insertImage rejects fetched bytes it did resolve', async () => {
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    // resolveImage's own detectImageExt call succeeds (so it hands insertImage
    // a real buffer), but insertImage's independent detectImageExt call then
    // fails — the one path where insertImage, not resolveImage, is the rejector.
    detectImageExt.mockResolvedValueOnce('.png').mockResolvedValueOnce(null)

    const result = await batchFetchImagesForTokens([
      { listTokenId: 'lt-1', uri: 'https://x/icon.png', originalUri: 'https://x/icon.png', providerKey: 'trustwallet' },
    ])

    // Distinct from the null case above: resolveImage succeeded (real bytes,
    // real extension detection input), so a caller inspecting this batch can
    // tell "we never got bytes" (null) apart from "we got bytes insertImage
    // refused" (this shaped error).
    expect(result[0].result).toEqual({ listTokenId: 'lt-1', success: false, error: 'Failed to insert image' })
  })

  it('catches a thrown database error and reports it as a failure without aborting the batch', async () => {
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueRejection(new Error('connection terminated unexpectedly'))

    const result = await batchFetchImagesForTokens([
      { listTokenId: 'lt-1', uri: 'https://x/icon.png', originalUri: 'https://x/icon.png', providerKey: 'trustwallet' },
    ])

    expect(result[0].result).toMatchObject({ listTokenId: 'lt-1', success: false })
    expect((result[0].result as { error: Error }).error).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// fetchImageAndStoreForToken
// ---------------------------------------------------------------------------

describe('fetchImageAndStoreForToken', () => {
  const baseToken = {
    networkId: 'network-1',
    providedId: '0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD',
    name: 'Coin',
    symbol: 'COIN',
    decimals: 18,
  }

  it('throws immediately when listId is missing, without issuing any query', async () => {
    await expect(
      fetchImageAndStoreForToken({
        listId: '',
        listTokenOrderId: 1,
        uri: null,
        originalUri: null,
        token: baseToken,
        providerKey: 'trustwallet',
      }),
    ).rejects.toThrow('listId is required')

    expect(harness.queries).toHaveLength(0)
  })

  it('short-circuits on a fresh cached image whose token metadata and list order already match', async () => {
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }]) // getFreshImageFromLink: link
    harness.queueResult([{ imageHash: 'hash-1' }]) // getFreshImageFromLink: image
    harness.queueResult([{ tokenId: 'token-1', name: 'Coin', symbol: 'COIN', decimals: 18 }]) // insertToken
    harness.queueResult([{ tokenId: 'token-1', listTokenOrderId: 5, listTokenId: 'lt-1', listId: 'list-1' }]) // getListToken

    const result = await fetchImageAndStoreForToken({
      listId: 'list-1',
      listTokenOrderId: 5,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      token: baseToken,
      providerKey: 'trustwallet',
    })

    // No re-fetch and no second insertToken/insertListToken — the entire point
    // of this branch is skipping repeat work for a token whose stored fields
    // and list position have not moved since the last successful collection.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(harness.queries).toHaveLength(4)
    expect(result.listToken).toMatchObject({ listTokenId: 'lt-1' })
    expect(result.token).toMatchObject({ tokenId: 'token-1' })
  })

  it('falls through to a full re-fetch when the fresh cache exists but no matching list-token row does', async () => {
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }]) // getFreshImageFromLink: link
    harness.queueResult([{ imageHash: 'hash-1' }]) // getFreshImageFromLink: image
    harness.queueResult([{ tokenId: 'token-1', name: 'Coin', symbol: 'COIN', decimals: 18 }]) // insertToken (cache-hit branch)
    harness.queueResult([]) // getListToken: no matching row
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }]) // insertImage: image insert
    harness.queueResult([{ uri: 'https://x/icon.png' }]) // insertImage: link insert
    harness.queueResult([{ tokenId: 'token-1', name: 'Coin', symbol: 'COIN', decimals: 18 }]) // insertToken (unconditional)
    harness.queueResult([{ listTokenId: 'lt-2', tokenId: 'token-1', listId: 'list-1', imageHash: 'hash-new' }]) // insertListToken

    const result = await fetchImageAndStoreForToken({
      listId: 'list-1',
      listTokenOrderId: 5,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      token: baseToken,
      providerKey: 'trustwallet',
    })

    expect(fetchMock).toHaveBeenCalled()
    expect(result.listToken).toMatchObject({ listTokenId: 'lt-2' })
    expect(result.image).toMatchObject({ imageHash: 'hash-new' })
  })

  // Drift in ANY of the three compared fields has to skip the short-circuit.
  // Exercising only one of them would let a regression in the other two
  // through — upstream corrections arrive in whichever field was wrong.
  it.each([
    ['decimals', { tokenId: 'token-1', name: 'Coin', symbol: 'COIN', decimals: 6 }],
    ['name', { tokenId: 'token-1', name: 'Coin Classic', symbol: 'COIN', decimals: 18 }],
    ['symbol', { tokenId: 'token-1', name: 'Coin', symbol: 'CN', decimals: 18 }],
  ])(
    'falls through to a full re-fetch, without even checking list-token order, when the stored %s has drifted',
    async (_field, storedToken) => {
      harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }]) // getFreshImageFromLink: link
      harness.queueResult([{ imageHash: 'hash-1' }]) // getFreshImageFromLink: image
      harness.queueResult([storedToken]) // insertToken (cache-hit branch)
      fetchMock.mockResolvedValue(new Response(PNG_BYTES))
      detectImageExt.mockResolvedValue('.png')
      sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
      harness.queueResult([{ imageHash: 'hash-new' }]) // insertImage: image insert
      harness.queueResult([{ uri: 'https://x/icon.png' }]) // insertImage: link insert
      harness.queueResult([storedToken]) // insertToken (unconditional)
      harness.queueResult([{ listTokenId: 'lt-2', tokenId: 'token-1', listId: 'list-1', imageHash: 'hash-new' }]) // insertListToken

      const result = await fetchImageAndStoreForToken({
        listId: 'list-1',
        listTokenOrderId: 5,
        uri: 'https://x/icon.png',
        originalUri: 'https://x/icon.png',
        token: baseToken,
        providerKey: 'trustwallet',
      })

      // Exactly 7 queries: no getListToken select — the metadata mismatch skips
      // straight past that check to the bottom, full-refetch path.
      expect(harness.queries).toHaveLength(7)
      expect(result.listToken).toMatchObject({ listTokenId: 'lt-2' })
    },
  )

  it('stores the token without an image when there is no uri to fetch at all', async () => {
    harness.queueResult([{ tokenId: 'token-1', name: 'Coin', symbol: 'COIN', decimals: 18 }]) // insertToken
    harness.queueResult([{ listTokenId: 'lt-1', tokenId: 'token-1', listId: 'list-1', imageHash: null }]) // insertListToken

    const result = await fetchImageAndStoreForToken({
      listId: 'list-1',
      listTokenOrderId: 1,
      uri: null,
      originalUri: null,
      token: baseToken,
      providerKey: 'trustwallet',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(harness.queries).toHaveLength(2)
    expect(result.image).toBeUndefined()
  })

  it('records a miss but still stores the token image-less when the fetch fails', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockRejectedValue(new Error('connection reset'))
    harness.queueResult([{ tokenId: 'token-1', name: 'Coin', symbol: 'COIN', decimals: 18 }]) // insertToken
    harness.queueResult([{ listTokenId: 'lt-1', tokenId: 'token-1', listId: 'list-1', imageHash: null }]) // insertListToken

    const result = await fetchImageAndStoreForToken({
      listId: 'list-1',
      listTokenOrderId: 1,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      token: baseToken,
      providerKey: 'trustwallet',
    })

    // Deliberate (see the comment above this branch in db/index.ts): a token
    // still gets stored so a later run can attach the image without
    // re-discovering the token from scratch.
    expect(fsPromises.writeFile).toHaveBeenCalled()
    expect(result.image).toBeUndefined()
    expect(result.token).toMatchObject({ tokenId: 'token-1' })
  })

  it('stores the token and image on a full success, passing a non-EVM providedId through unchanged', async () => {
    const solanaToken = { ...baseToken, providedId: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' }
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }]) // insertImage: image insert
    harness.queueResult([{ uri: 'https://x/icon.png' }]) // insertImage: link insert
    harness.queueResult([{ tokenId: 'token-1', providedId: solanaToken.providedId }]) // insertToken
    harness.queueResult([{ listTokenId: 'lt-1', tokenId: 'token-1', listId: 'list-1', imageHash: 'hash-new' }]) // insertListToken

    const result = await fetchImageAndStoreForToken({
      listId: 'list-1',
      listTokenOrderId: 1,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      token: solanaToken,
      providerKey: 'trustwallet',
    })

    expect(result.image).toMatchObject({ imageHash: 'hash-new' })
    expect(result.token).toMatchObject({ providedId: solanaToken.providedId })
  })

  it('derives originalUri from uri when the caller passes originalUri: null', async () => {
    harness.queueResult([]) // getFreshImageFromLink: link lookup misses
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }]) // insertImage: image insert
    harness.queueResult([{ uri: 'https://x/icon.png' }]) // insertImage's link insert
    harness.queueResult([{ tokenId: 'token-1' }]) // insertToken
    harness.queueResult([{ listTokenId: 'lt-1' }]) // insertListToken

    await fetchImageAndStoreForToken({
      listId: 'list-1',
      listTokenOrderId: 1,
      uri: 'https://x/icon.png',
      originalUri: null,
      token: baseToken,
      providerKey: 'trustwallet',
    })

    const linkInsert = harness.queries.filter((query) => query.root === 'insert')[1]
    const row = linkInsert.steps.find((step) => step.method === 'values')?.args[0] as { uri: string }
    expect(row.uri).toBe('https://x/icon.png')
  })
})
