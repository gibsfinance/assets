import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, createLogAppMock, renderSql, sqlParams } from './__testing__/drizzle-harness'

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
  prewarmImages,
  purgePlaceholderNetworkIcons,
  purgeUnreferencedPlaceholderImages,
} from './index'
import * as s from './schema'
import { getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { placeholderByteLengths } from '../image-placeholders'

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

/**
 * The real DexScreener "no artwork for this chain" icon, sanitized the way
 * storage would sanitize it. Both modules are pulled in unmocked: this file
 * replaces `fs` and `../sanitize` wholesale, and the point of the fixture is to
 * exercise the guard against the genuine bytes rather than a stand-in.
 */
const sanitizedPlaceholder = async () => {
  const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  const { sanitizeImage: realSanitize } = await vi.importActual<typeof import('../sanitize')>('../sanitize')
  const raw = readFileSync(`${__dirname}/../harvested/dexscreener/chain-placeholder.png`)
  return { raw, sanitized: await realSanitize(raw, '.png') }
}

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

  it('rejects a known upstream placeholder without storing anything', async () => {
    // DexScreener answers a chain it has no artwork for with HTTP 200 and a grey
    // question mark, so it arrives indistinguishable from a real logo: right
    // content type, decodes cleanly, and at 678 bytes it clears the minimum-size
    // rule comfortably. Only the picture gives it away. Storing one is worse than
    // storing nothing, because it then ranks by DexScreener's priority — high
    // enough to hold thirteen chains against the fallbacks carrying their real
    // icons.
    const { raw, sanitized } = await sanitizedPlaceholder()
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(sanitized)

    const result = await insertImage({
      providerKey: 'dexscreener',
      originalUri: 'https://dd.dexscreener.com/ds-data/chains/iotex.png',
      image: raw,
      listId: null,
    })

    expect(result).toBeNull()
    expect(harness.queries).toHaveLength(0)
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

describe('purgePlaceholderNetworkIcons', () => {
  it('releases a slot whose stored icon is a known placeholder', async () => {
    const { sanitized } = await sanitizedPlaceholder()
    harness.queueResult([{ networkId: 'network-1', chainId: 'eip155-4689', content: sanitized }])
    harness.queueResult([])

    const released = await purgePlaceholderNetworkIcons()

    expect(released).toEqual(['eip155-4689'])
    const update = harness.queries.find((query) => query.root === 'update')
    // Both columns go, not just the hash: leaving the provider key behind would
    // claim the slot was won by a collector that no longer holds it.
    expect(update?.steps.find((step) => step.method === 'set')?.args[0]).toEqual({
      imageHash: null,
      imageProviderKey: null,
    })
  })

  it('leaves a real icon of the same byte length alone', async () => {
    // The database narrows candidates by length, which is a prefilter and not a
    // verdict. A genuine logo that happens to weigh the same must survive the
    // hash check, or the purge is deleting artwork it was written to protect.
    const { sanitized } = await sanitizedPlaceholder()
    const lookalike = Buffer.concat([
      sanitized.subarray(0, sanitized.length - 1),
      Buffer.from([sanitized[sanitized.length - 1] ^ 0xff]),
    ])
    harness.queueResult([{ networkId: 'network-1', chainId: 'eip155-1', content: lookalike }])

    const released = await purgePlaceholderNetworkIcons()

    expect(released).toEqual([])
    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(0)
  })

  it('narrows candidates by byte length in the database rather than hashing every icon', async () => {
    harness.queueResult([])

    await purgePlaceholderNetworkIcons()

    const select = harness.queries.find((query) => query.root === 'select')
    const where = select?.steps.find((step) => step.method === 'where')?.args[0]
    // Nearly two thousand networks carry an icon; without this the purge would
    // pull every stored image across the wire on every collect run.
    expect(renderSql(where)).toContain('octet_length')
    expect(sqlParams(where)).toEqual(placeholderByteLengths)
  })

  it('issues no update when nothing matches', async () => {
    harness.queueResult([])

    expect(await purgePlaceholderNetworkIcons()).toEqual([])
    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(0)
  })
})

describe('purgeUnreferencedPlaceholderImages', () => {
  const deletes = () => harness.queries.filter((query) => query.root === 'delete')
  const targetOf = (query: (typeof harness.queries)[number] | undefined) =>
    getTableName(query?.steps[0]?.args[0] as PgTable)
  /** The two deletes that must prove nothing references a row before removing it. */
  const guardedDeletes = () => deletes().filter((query) => targetOf(query) !== 'link')
  const whereOf = (query: (typeof harness.queries)[number] | undefined) =>
    query?.steps.find((step) => step.method === 'where')?.args[0]

  it('deletes a stored placeholder that nothing points at', async () => {
    const { sanitized } = await sanitizedPlaceholder()
    harness.queueResult([{ imageHash: 'hash-1', content: sanitized }])
    harness.queueResult([]) // link delete
    harness.queueResult([]) // variant delete
    harness.queueResult([{ imageHash: 'hash-1' }]) // image delete, returning

    expect(await purgeUnreferencedPlaceholderImages()).toEqual(['hash-1'])
  })

  it('clears the cached fetch result first, or the image can never be reclaimed at all', async () => {
    // insertImage writes the link row in the same call that stores the image,
    // and that upsert's conflict set never re-points image_hash — so the
    // reference is frozen at first write. Treated as a use rather than as the
    // cache it is, it would hold every placeholder ever stored in place
    // permanently and the sweep would delete nothing, ever.
    const { sanitized } = await sanitizedPlaceholder()
    harness.queueResult([{ imageHash: 'hash-1', content: sanitized }])
    harness.queueResult([])
    harness.queueResult([])
    harness.queueResult([{ imageHash: 'hash-1' }])

    await purgeUnreferencedPlaceholderImages()

    // The rest of the order matters too: image_variant's foreign key onto image
    // carries no ON DELETE clause, so the image cannot go while a resized copy
    // remains — and a variant left behind would keep serving the placeholder
    // out of the resize cache after its source row was gone.
    expect(deletes().map(targetOf)).toEqual(['link', 'image_variant', 'image'])
    // Unconditional on the referrer guards: a link row pointing at a
    // placeholder is worthless whatever else happens to hold the image.
    expect(renderSql(whereOf(deletes()[0]))).not.toContain('not exists')
  })

  it('leaves a real image of the same byte length alone', async () => {
    // The length filter is a prefilter, not a verdict. A genuine logo weighing
    // the same as the placeholder must survive the hash check or the sweep is
    // deleting the artwork the whole exercise exists to protect.
    const { sanitized } = await sanitizedPlaceholder()
    const lookalike = Buffer.concat([
      sanitized.subarray(0, sanitized.length - 1),
      Buffer.from([sanitized[sanitized.length - 1] ^ 0xff]),
    ])
    harness.queueResult([{ imageHash: 'hash-1', content: lookalike }])

    expect(await purgeUnreferencedPlaceholderImages()).toEqual([])
    expect(deletes()).toHaveLength(0)
  })

  it('issues no delete when nothing matches', async () => {
    harness.queueResult([])

    expect(await purgeUnreferencedPlaceholderImages()).toEqual([])
    expect(deletes()).toHaveLength(0)
  })

  it('narrows candidates by byte length in the database rather than hashing every stored image', async () => {
    harness.queueResult([])

    await purgeUnreferencedPlaceholderImages()

    const where = whereOf(harness.queries.find((query) => query.root === 'select'))
    expect(renderSql(where)).toContain('octet_length')
    expect(sqlParams(where)).toEqual(placeholderByteLengths)
  })

  it('guards both reclaiming deletes against every table in the schema that can reference an image', async () => {
    // Derived from the schema rather than restated, so adding a table with an
    // image_hash column fails here instead of silently letting the sweep delete
    // a row that table still points at. Two of those foreign keys cascade, so
    // the failure would take the referring row with it rather than erroring.
    const referrers = Object.values(s)
      .filter((value) => is(value, PgTable) && 'imageHash' in value)
      .map((table) => getTableName(table as PgTable))
      .filter((name) => name !== 'image' && name !== 'image_variant')
    expect(referrers.length).toBeGreaterThan(0)

    const { sanitized } = await sanitizedPlaceholder()
    harness.queueResult([{ imageHash: 'hash-1', content: sanitized }])
    harness.queueResult([])
    harness.queueResult([])
    harness.queueResult([{ imageHash: 'hash-1' }])

    await purgeUnreferencedPlaceholderImages()

    expect(guardedDeletes()).toHaveLength(2)
    for (const query of guardedDeletes()) {
      const rendered = renderSql(whereOf(query))
      for (const name of referrers) {
        expect(rendered, `${name} is not guarded against`).toContain(`from "${name}"`)
      }
    }
  })

  it('correlates every guard against the table its own delete targets', async () => {
    // Both deletes carry the same five subqueries, and each must correlate on
    // the image_hash of the table it is deleting from. Correlating the variant
    // delete against `image` instead is not merely wrong, it is invalid SQL —
    // `image` appears in no FROM clause that subquery can reach, and Postgres
    // rejects the statement outright.
    //
    // Read out of the NOT EXISTS clauses specifically rather than the whole
    // WHERE: the inArray term names the same column, so a substring check
    // against the rendered statement passes whatever the correlation says.
    const correlationsIn = (sql: string) => [...sql.matchAll(/= "(\w+)"\."image_hash"\)/g)].map(([, table]) => table)

    const { sanitized } = await sanitizedPlaceholder()
    harness.queueResult([{ imageHash: 'hash-1', content: sanitized }])
    harness.queueResult([])
    harness.queueResult([])
    harness.queueResult([{ imageHash: 'hash-1' }])

    await purgeUnreferencedPlaceholderImages()

    for (const query of guardedDeletes()) {
      const target = targetOf(query)
      const correlations = correlationsIn(renderSql(whereOf(query)))
      expect(correlations.length, `${target} delete carries no correlated guard`).toBeGreaterThan(0)
      expect(new Set(correlations), `${target} delete correlates elsewhere`).toEqual(new Set([target]))
    }
  })

  it('reports what the delete actually removed, not what it set out to remove', async () => {
    // The candidate list is everything that looked deletable before the guards
    // ran; the returning clause is what survived them. Reporting the former
    // would announce images as reclaimed while they sit untouched, still
    // referenced, and still served.
    const { sanitized } = await sanitizedPlaceholder()
    harness.queueResult([
      { imageHash: 'unreferenced', content: sanitized },
      { imageHash: 'still-in-use', content: sanitized },
    ])
    harness.queueResult([])
    harness.queueResult([])
    harness.queueResult([{ imageHash: 'unreferenced' }])

    expect(await purgeUnreferencedPlaceholderImages()).toEqual(['unreferenced'])
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

describe('fetchImage placeholder addresses', () => {
  it('turns away a known placeholder address without making the request', async () => {
    // CoinGecko exports point at missing_large.png rather than omitting logoURI,
    // so without this every logo-less coin costs a round trip and then stores a
    // link row for a picture of nothing.
    const result = await fetchImage(
      'https://assets.coingecko.com/coins/images/1/large/missing_large.png',
      undefined,
      'coingecko',
    )

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still fetches a real logo from the same host', async () => {
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))

    const result = await fetchImage(
      'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
      undefined,
      'coingecko',
    )

    expect(result).not.toBeNull()
    expect(fetchMock).toHaveBeenCalled()
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

  it('reports a fresh link to a stored placeholder as missing', async () => {
    // The guard in insertImage only ever sees the first download of an address.
    // Once a placeholder is stored it stays fresh for a week, and every run in
    // between reuses it from here — no request, no insert, no guard. Measured in
    // production: a sweep released twenty-one chain icon slots and nineteen were
    // taken straight back from cache within the same run.
    const { sanitized } = await sanitizedPlaceholder()
    harness.queueResult([{ uri: 'https://dd.dexscreener.com/ds-data/chains/iotex.png', imageHash: 'hash-1' }])
    harness.queueResult([{ imageHash: 'hash-1', content: sanitized }])
    const result = await getFreshImageFromLink('https://dd.dexscreener.com/ds-data/chains/iotex.png', 1000)
    expect(result).toBeNull()
  })

  it('returns a fresh link to real artwork', async () => {
    // The counterpart to the above: rejecting on content must not reject content
    // that is merely stored, or every cached logo would be re-downloaded forever.
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }])
    harness.queueResult([{ imageHash: 'hash-1', content: PNG_BYTES }])
    const result = await getFreshImageFromLink('https://x/icon.png', 1000)
    expect(result).toEqual({
      link: { uri: 'https://x/icon.png', imageHash: 'hash-1' },
      image: { imageHash: 'hash-1', content: PNG_BYTES },
    })
  })

  it('returns a link-mode row, whose image carries no content to inspect', async () => {
    harness.queueResult([{ uri: 'https://x/icon.svg', imageHash: 'hash-2' }])
    harness.queueResult([{ imageHash: 'hash-2', content: null }])
    const result = await getFreshImageFromLink('https://x/icon.svg', 1000)
    expect(result).toEqual({
      link: { uri: 'https://x/icon.svg', imageHash: 'hash-2' },
      image: { imageHash: 'hash-2', content: null },
    })
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
    harness.queueResult([]) // getFreshImageFromLink: no cached link, so the download runs
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
    // One freshness miss per item — both are checked before either downloads.
    harness.queueResult([])
    harness.queueResult([])
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
    harness.queueResult([]) // freshness miss, so the download path is the one under test

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
    // Miss the freshness check first, so the error under test comes from the write
    // path rather than from the lookup that now precedes it.
    harness.queueResult([])
    harness.queueRejection(new Error('connection terminated unexpectedly'))

    const result = await batchFetchImagesForTokens([
      { listTokenId: 'lt-1', uri: 'https://x/icon.png', originalUri: 'https://x/icon.png', providerKey: 'trustwallet' },
    ])

    expect(result[0].result).toMatchObject({ listTokenId: 'lt-1', success: false })
    expect((result[0].result as { error: Error }).error).toBeInstanceOf(Error)
  })

  it('reuses a logo already inside its freshness window instead of downloading it again', async () => {
    // The reason this matters is cost, not tidiness: this batch path is the one etherscan
    // uses, and without the check it re-downloaded, re-sanitized and rewrote every logo it
    // had ever seen on every collect run. The freshness window exists to stop exactly that,
    // and every sibling fetch path in the module already honours it.
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-cached' }])
    harness.queueResult([{ imageHash: 'hash-cached', ext: '.png' }])
    harness.queueResult([{ listTokenId: 'lt-1' }])

    const result = await batchFetchImagesForTokens([
      { listTokenId: 'lt-1', uri: 'https://x/icon.png', originalUri: 'https://x/icon.png', providerKey: 'trustwallet' },
    ])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sanitizeImage).not.toHaveBeenCalled()
    // No image or link row is rewritten — the stored bytes are already the answer.
    expect(harness.queries.filter((query) => query.root === 'insert')).toHaveLength(0)
    expect(result[0].result).toMatchObject({ listTokenId: 'lt-1', success: true })
    expect((result[0].result as { image: { imageHash: string } }).image.imageHash).toBe('hash-cached')
  })

  it('still links the list_token on a cache hit, because cached bytes do not imply a link', async () => {
    // The half of the work that is never redundant. A cache hit means the image is on
    // disk; it says nothing about whether this list_token — which may belong to a list
    // version created minutes ago — references it yet. Skipping this update would leave
    // the new version's tokens icon-less, which is worse than the re-download it saves.
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-cached' }])
    harness.queueResult([{ imageHash: 'hash-cached', ext: '.png' }])
    harness.queueResult([{ listTokenId: 'lt-1' }])

    await batchFetchImagesForTokens([
      { listTokenId: 'lt-1', uri: 'https://x/icon.png', originalUri: 'https://x/icon.png', providerKey: 'trustwallet' },
    ])

    const updateQuery = harness.queries.find((query) => query.root === 'update')
    const setStep = updateQuery?.steps.find((step) => step.method === 'set')
    const whereStep = updateQuery?.steps.find((step) => step.method === 'where')
    expect(setStep?.args[0]).toEqual({ imageHash: 'hash-cached' })
    expect(sqlParams(whereStep?.args[0])).toEqual(['lt-1'])
  })

  it('downloads when the link is fresh but its image row is gone', async () => {
    // A link outliving its image would otherwise strand the token on a hash that resolves
    // to nothing. getFreshImageFromLink reports the pair as absent, and this asserts the
    // batch path treats that as a miss rather than trusting the link alone.
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-orphaned' }])
    harness.queueResult([]) // the image row it pointed at is gone
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }])
    harness.queueResult([{ listTokenId: 'lt-1' }])

    const result = await batchFetchImagesForTokens([
      { listTokenId: 'lt-1', uri: 'https://x/icon.png', originalUri: 'https://x/icon.png', providerKey: 'trustwallet' },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((result[0].result as { image: { imageHash: string } }).image.imageHash).toBe('hash-new')
  })

  it('narrows the freshness window when an item supplies its own maxImageAge', async () => {
    // A caller that knows a provider rotates icons faster than the shared week-long
    // default needs a way to say so per item, matching the maxImageAge every sibling
    // fetch path already accepts. Asserted on the bound cutoff rather than on the call,
    // because the cutoff is the only thing the database actually sees.
    harness.queueResult([])
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }])
    harness.queueResult([{ uri: 'https://x/icon.png' }])
    harness.queueResult([{ listTokenId: 'lt-1' }])

    const before = Date.now()
    await batchFetchImagesForTokens([
      {
        listTokenId: 'lt-1',
        uri: 'https://x/icon.png',
        originalUri: 'https://x/icon.png',
        providerKey: 'trustwallet',
        maxImageAge: 60_000,
      },
    ])
    const after = Date.now()

    const linkQuery = harness.queries.find((query) => query.root === 'select')
    const whereStep = linkQuery?.steps.find((step) => step.method === 'where')
    const [uri, cutoff] = sqlParams(whereStep?.args[0])
    expect(uri).toBe('https://x/icon.png')
    const cutoffMs = Date.parse(cutoff as string)
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 60_000)
    expect(cutoffMs).toBeLessThanOrEqual(after - 60_000)
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

  it('rewrites the list-token row against the cached image rather than downloading it again', async () => {
    // Missing the short-circuit means the list-token row is stale, not that the bytes
    // are. Re-downloading here is what made a version bump so expensive: list_id hashes
    // the version tuple, so a bump gives every token an empty list_id, getListToken can
    // never match, and all of them landed on this path and re-fetched an image the line
    // above had just confirmed fresh — at up to three seconds of timeout apiece.
    harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }]) // getFreshImageFromLink: link
    harness.queueResult([{ imageHash: 'hash-1' }]) // getFreshImageFromLink: image
    harness.queueResult([{ tokenId: 'token-1', name: 'Coin', symbol: 'COIN', decimals: 18 }]) // insertToken (cache-hit branch)
    harness.queueResult([]) // getListToken: no matching row
    harness.queueResult([{ tokenId: 'token-1', name: 'Coin', symbol: 'COIN', decimals: 18 }]) // insertToken (unconditional)
    harness.queueResult([{ listTokenId: 'lt-2', tokenId: 'token-1', listId: 'list-1', imageHash: 'hash-1' }]) // insertListToken

    const result = await fetchImageAndStoreForToken({
      listId: 'list-1',
      listTokenOrderId: 5,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      token: baseToken,
      providerKey: 'trustwallet',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    // Six queries, not eight: no insertImage image/link pair either, because both rows
    // already hold exactly what that upsert would write.
    expect(harness.queries).toHaveLength(6)
    expect(result.listToken).toMatchObject({ listTokenId: 'lt-2' })
    // The cached hash, carried through — not a newly minted one.
    expect(result.image).toMatchObject({ imageHash: 'hash-1' })
  })

  // Drift in ANY of the three compared fields has to skip the short-circuit.
  // Exercising only one of them would let a regression in the other two
  // through — upstream corrections arrive in whichever field was wrong.
  it.each([
    ['decimals', { tokenId: 'token-1', name: 'Coin', symbol: 'COIN', decimals: 6 }],
    ['name', { tokenId: 'token-1', name: 'Coin Classic', symbol: 'COIN', decimals: 18 }],
    ['symbol', { tokenId: 'token-1', name: 'Coin', symbol: 'CN', decimals: 18 }],
  ])(
    'rewrites against the cached image, without even checking list-token order, when the stored %s has drifted',
    async (_field, storedToken) => {
      harness.queueResult([{ uri: 'https://x/icon.png', imageHash: 'hash-1' }]) // getFreshImageFromLink: link
      harness.queueResult([{ imageHash: 'hash-1' }]) // getFreshImageFromLink: image
      harness.queueResult([storedToken]) // insertToken (cache-hit branch)
      harness.queueResult([storedToken]) // insertToken (unconditional)
      harness.queueResult([{ listTokenId: 'lt-2', tokenId: 'token-1', listId: 'list-1', imageHash: 'hash-1' }]) // insertListToken

      const result = await fetchImageAndStoreForToken({
        listId: 'list-1',
        listTokenOrderId: 5,
        uri: 'https://x/icon.png',
        originalUri: 'https://x/icon.png',
        token: baseToken,
        providerKey: 'trustwallet',
      })

      // Exactly 5 queries: no getListToken select — the metadata mismatch skips straight
      // past that check — and no image download or insert, since drifted metadata says
      // nothing about whether the logo moved.
      expect(harness.queries).toHaveLength(5)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.listToken).toMatchObject({ listTokenId: 'lt-2' })
    },
  )

  it('still downloads when the cached image has gone stale', async () => {
    // The counterpart to the two above: reuse is conditional on getFreshImageFromLink
    // finding something. An expired or absent link still takes the full path, which is
    // what keeps a changed logo from being pinned to its old bytes forever.
    harness.queueResult([]) // getFreshImageFromLink: no fresh link
    fetchMock.mockResolvedValue(new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-new' }]) // insertImage: image insert
    harness.queueResult([{ uri: 'https://x/icon.png' }]) // insertImage: link insert
    harness.queueResult([{ tokenId: 'token-1', name: 'Coin', symbol: 'COIN', decimals: 18 }]) // insertToken
    harness.queueResult([{ listTokenId: 'lt-3', tokenId: 'token-1', listId: 'list-1', imageHash: 'hash-new' }]) // insertListToken

    const result = await fetchImageAndStoreForToken({
      listId: 'list-1',
      listTokenOrderId: 5,
      uri: 'https://x/icon.png',
      originalUri: 'https://x/icon.png',
      token: baseToken,
      providerKey: 'trustwallet',
    })

    expect(fetchMock).toHaveBeenCalled()
    expect(result.image).toMatchObject({ imageHash: 'hash-new' })
  })

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

// ---------------------------------------------------------------------------
// prewarmImages
// ---------------------------------------------------------------------------

describe('prewarmImages', () => {
  it('downloads each distinct uri once, ignoring empty and absent ones', async () => {
    // Lists routinely point many tokens at one logo — every wrapped variant of an asset,
    // every chain a bridged token lives on. Downloading per token rather than per uri is
    // the difference between one request and several hundred for the same bytes.
    harness.queueResult([]) // getFreshImageFromLink: link miss for a.png
    harness.queueResult([]) // getFreshImageFromLink: link miss for b.png
    // A fresh Response per call: these downloads run concurrently and a body can only be
    // read once, so a single shared instance would leave the second caller with nothing.
    fetchMock.mockImplementation(async () => new Response(PNG_BYTES))
    detectImageExt.mockResolvedValue('.png')
    sanitizeImage.mockResolvedValue(Buffer.from('sanitized'))
    harness.queueResult([{ imageHash: 'hash-a' }])
    harness.queueResult([{ uri: 'https://x/a.png' }])
    harness.queueResult([{ imageHash: 'hash-b' }])
    harness.queueResult([{ uri: 'https://x/b.png' }])

    const result = await prewarmImages({
      uris: ['https://x/a.png', 'https://x/b.png', 'https://x/a.png', null, undefined, ''],
      providerKey: 'trustwallet',
      listId: 'list-1',
    })

    expect(result.distinct).toBe(2)
    expect(result.fetched).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not download a uri whose bytes are already fresh', async () => {
    // The whole point of running before the write loop is that the loop then finds every
    // link fresh. Re-downloading here would move the cost rather than remove it.
    harness.queueResult([{ uri: 'https://x/a.png', imageHash: 'hash-a' }]) // link hit
    harness.queueResult([{ imageHash: 'hash-a' }]) // image hit

    const result = await prewarmImages({
      uris: ['https://x/a.png'],
      providerKey: 'trustwallet',
      listId: 'list-1',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.fetched).toBe(0)
    expect(result.missing.size).toBe(0)
  })

  it('reports a uri it could not fetch so the caller stops asking for it', async () => {
    // Returned rather than swallowed: the write loop blanks these, which is what keeps a
    // dead host from being retried once per token that references it.
    harness.queueResult([]) // getFreshImageFromLink: miss
    fetchMock.mockRejectedValue(new Error('ENOTFOUND'))

    const result = await prewarmImages({
      uris: ['https://dead/a.png'],
      providerKey: 'trustwallet',
      listId: 'list-1',
    })

    expect(result.missing.has('https://dead/a.png')).toBe(true)
    expect(result.fetched).toBe(0)
    // The miss is still recorded on disk, exactly as a failure inside the loop recorded it.
    expect(fsPromises.writeFile).toHaveBeenCalled()
  })

  it('stops starting new downloads once the signal aborts', async () => {
    // Prewarming a large list is the longest-running thing in a collect run, so a shutdown
    // that only took effect at the end of it would not be a shutdown.
    const controller = new AbortController()
    controller.abort()

    const result = await prewarmImages({
      uris: ['https://x/a.png', 'https://x/b.png'],
      providerKey: 'trustwallet',
      listId: 'list-1',
      signal: controller.signal,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.fetched).toBe(0)
    expect(harness.queries).toHaveLength(0)
  })
})
