import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, createLogAppMock, renderSql, sqlParams } from './__testing__/drizzle-harness'

const harness = createDrizzleHarness()
vi.mock('./drizzle', () => ({ getDrizzle: () => harness.db }))
vi.mock('../log/App', () => createLogAppMock())

// Static imports (rather than a per-test `await import('./index')`) so the
// module graph — drizzle-orm, the PgDialect renderer, `db/index.ts` itself —
// loads once during file setup instead of inside a test's own timeout budget.
// `db/index.ts` has no module-scoped cache that a fresh instance would need to
// reset (unlike sync-order's cached order id), so a single shared import is safe.
import {
  applyOrder,
  getTokensByChainRanked,
  getTokensWithExtensions,
  getTokenSourcesByChain,
  getTokenCountsByChain,
  getTokensUnderListId,
} from './index'
import { eq } from 'drizzle-orm'
import * as s from './schema'

beforeEach(() => {
  harness.reset()
})

// ---------------------------------------------------------------------------
// applyOrder — the dense_rank common-table-expression behind image priority
// ---------------------------------------------------------------------------

describe('applyOrder', () => {
  it('dedupes to rank 1 by default, and drops the filter when dedupe is false', async () => {
    harness.queueResult({ rows: [{ tokenId: 'token-1' }] })
    await applyOrder('0xorder' as never, eq(s.network.chainId, 'eip155-1'))
    const dedupedSql = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    expect(dedupedSql).toContain('WHERE ls.rank = 1')

    harness.queueResult({ rows: [{ tokenId: 'token-1' }, { tokenId: 'token-1' }] })
    await applyOrder('0xorder' as never, eq(s.network.chainId, 'eip155-1'), 'listToken', undefined, { dedupe: false })
    const allRowsSql = renderSql((harness.queries[1].steps[0].args as unknown[])[0])
    // Token-list endpoints need every list_token row, not just the winner —
    // losing this branch would silently drop every non-primary image source.
    expect(allRowsSql).not.toContain('WHERE ls.rank = 1')
  })

  it('adds the outer ORDER BY only when sorted is requested', async () => {
    harness.queueResult({ rows: [] })
    await applyOrder('0xorder' as never, eq(s.network.chainId, 'eip155-1'), 'listToken', undefined, { sorted: true })
    const sortedSql = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    expect(sortedSql).toContain('ORDER BY (ls."listRanking"')

    harness.queueResult({ rows: [] })
    await applyOrder('0xorder' as never, eq(s.network.chainId, 'eip155-1'))
    const unsortedSql = renderSql((harness.queries[1].steps[0].args as unknown[])[0])
    expect(unsortedSql).not.toContain('ORDER BY (ls."listRanking"')
  })

  it('switches the join direction based on baseFrom without changing the ranking logic', async () => {
    harness.queueResult({ rows: [] })
    await applyOrder('0xorder' as never, eq(s.network.chainId, 'eip155-1'), 'provider')
    const providerSql = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    // 'provider' starts the FROM clause from provider and RIGHT JOINs down to
    // image — the shape getListTokens relies on to include providers with no
    // matching image row. Losing this would silently exclude imageless tokens.
    expect(providerSql).toContain('RIGHT JOIN')

    harness.queueResult({ rows: [] })
    await applyOrder('0xorder' as never, eq(s.network.chainId, 'eip155-1'), 'listToken')
    const listTokenSql = renderSql((harness.queries[1].steps[0].args as unknown[])[0])
    expect(listTokenSql).not.toContain('RIGHT JOIN')
  })

  it('omits image content from the selected columns unless includeContent is set', async () => {
    harness.queueResult({ rows: [] })
    await applyOrder('0xorder' as never, eq(s.network.chainId, 'eip155-1'))
    const withoutContent = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    expect(withoutContent).not.toMatch(/"image"\."content"/)

    harness.queueResult({ rows: [] })
    await applyOrder('0xorder' as never, eq(s.network.chainId, 'eip155-1'), 'listToken', undefined, {
      includeContent: true,
    })
    const withContent = renderSql((harness.queries[1].steps[0].args as unknown[])[0])
    // Image bytes are heavy; every list/browse endpoint must opt in explicitly
    // rather than accidentally shipping the raster payload with every row.
    expect(withContent).toMatch(/"image"\."content"/)
  })

  it('ranks svg above webp above other formats above no-image by default', async () => {
    harness.queueResult({ rows: [] })

    await applyOrder('0xorder' as never, eq(s.network.chainId, 'eip155-1'))

    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    const svgIndex = rendered.indexOf("IN ('.svg', '.svg+xml') THEN 0")
    const webpIndex = rendered.indexOf("= '.webp' THEN 1")
    // The default preference is the fallback for every caller that does not
    // pass its own formatPreference — flipping this ordering would swap which
    // image format wins for every list endpoint that omits ?as=.
    expect(svgIndex).toBeGreaterThan(-1)
    expect(webpIndex).toBeGreaterThan(svgIndex)
  })

  it('ranks each custom format-preference group ahead of formats outside every group', async () => {
    harness.queueResult({ rows: [] })

    await applyOrder('0xorder' as never, eq(s.network.chainId, 'eip155-1'), 'listToken', [['.png'], ['.jpg']])

    const fragment = (harness.queries[0].steps[0].args as unknown[])[0]
    const rendered = renderSql(fragment)
    const params = sqlParams(fragment)
    // Group 0 (.png) must outrank group 1 (.jpg), and anything with an
    // extension outside both groups ranks worst-but-one, ahead only of null —
    // a caller-supplied preference has to fully replace the svg-first default.
    expect(rendered).toContain('CASE WHEN "image"."ext" in ($1) THEN $2 WHEN "image"."ext" in ($3) THEN $4')
    expect(rendered).toContain('WHEN "image"."ext" IS NOT NULL THEN $5 ELSE $6 END')
    // The bound values carry the actual ranks: group 0 -> rank 0, group 1 ->
    // rank 1, any other real extension -> 2 (formatPreference.length), and a
    // null (no image) extension falls through to the final ELSE, rank 3.
    // The trailing two params are the CTE's own listOrderId/chainId bindings.
    expect(params).toEqual(['.png', 0, '.jpg', 1, 2, 3, '0xorder', 'eip155-1'])
  })
})

// ---------------------------------------------------------------------------
// getTokensByChainRanked
// ---------------------------------------------------------------------------

describe('getTokensByChainRanked', () => {
  it('pre-aggregates list_order_item duplicates with MIN(ranking) before joining to tokens', async () => {
    harness.queueResult({ rows: [{ tokenId: 'token-1' }] })

    const result = await getTokensByChainRanked('eip155-1', '0xorder' as never)

    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    // Without the MIN(ranking) aggregation, list_order_item's known duplicate
    // rows (up to 141 per list) multiply every list_token row in the join and
    // the query times out on Ethereum's token count — this is the entire
    // reason this query exists instead of reusing applyOrder.
    expect(rendered).toContain('MIN(')
    expect(rendered).toContain('DISTINCT ON')
    expect(result).toEqual([{ tokenId: 'token-1' }])
  })
})

// ---------------------------------------------------------------------------
// getTokensWithExtensions
// ---------------------------------------------------------------------------

describe('getTokensWithExtensions', () => {
  it('omits the bridge and header joins entirely when neither extension is requested', async () => {
    harness.queueResult({ rows: [{ chainId: 'eip155-1' }] })

    await getTokensWithExtensions('list-1')

    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    expect(rendered).not.toContain('bridge_link')
    expect(rendered).not.toContain('header_link')
  })

  it('camelCases the nested bridge row_to_json columns when bridgeInfo is requested', async () => {
    harness.queueResult({
      rows: [
        {
          chainId: 'eip155-1',
          bridge: { bridge_id: 'bridge-1', home_network_id: 'network-1' },
          bridgeLink: null,
          networkA: null,
          networkB: null,
          nativeToken: null,
          bridgedToken: null,
        },
      ],
    })

    const [row] = await getTokensWithExtensions('list-1', { bridgeInfo: true })

    // row_to_json() returns raw Postgres column names; the JS layer promises
    // camelCase everywhere else, so a caller reading row.bridge.bridgeId must
    // not have to special-case this one nested object.
    expect(row.bridge).toEqual({ bridgeId: 'bridge-1', homeNetworkId: 'network-1' })
    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    expect(rendered).toContain('bridge_link')
  })

  it('adds only the header join when headerUri is requested without bridgeInfo', async () => {
    harness.queueResult({ rows: [{ chainId: 'eip155-1', headerImageHash: 'hash-1' }] })

    const rows = await getTokensWithExtensions('list-1', { headerUri: true })

    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    expect(rendered).toContain('header_link')
    expect(rendered).not.toContain('bridge_link')
    // bridgeInfo: false means the row is returned as-is, with no camelCaseKeys
    // pass — asserts the two extensions are independent, not a shared branch.
    expect(rows).toEqual([{ chainId: 'eip155-1', headerImageHash: 'hash-1' }])
  })
})

// ---------------------------------------------------------------------------
// getTokenSourcesByChain / getTokenCountsByChain
// ---------------------------------------------------------------------------

describe('getTokenSourcesByChain', () => {
  it('selects distinct (token, provider, list) triples for the requested chain', async () => {
    harness.queueResult([{ providedId: '0xabc', providerKey: 'trustwallet', listKey: 'wallet' }])

    const result = await getTokenSourcesByChain('eip155-1')

    expect(harness.queries[0].root).toBe('selectDistinct')
    expect(result).toEqual([{ providedId: '0xabc', providerKey: 'trustwallet', listKey: 'wallet' }])
  })
})

describe('getTokenCountsByChain', () => {
  it('coerces the count column from text to number and excludes the synthetic asset-0 chain', async () => {
    harness.queueResult({ rows: [{ chainId: 'eip155-1', count: '42' }] })

    const result = await getTokenCountsByChain()

    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    // asset-0 is a placeholder network with no real tokens; leaving it in would
    // put a bogus chain at the top of any "most tokens" ranking.
    expect(rendered).toContain("!= 'asset-0'")
    expect(result).toEqual([{ chainId: 'eip155-1', count: 42 }])
    expect(typeof result[0].count).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// getTokensUnderListId
// ---------------------------------------------------------------------------

describe('getTokensUnderListId', () => {
  it('left-joins image so a token with no image still appears in the result', async () => {
    harness.queueResult([{ tokenId: 'token-1', imageHash: null }])

    const rows = await getTokensUnderListId()

    const query = harness.queries[0]
    // LEFT JOIN on image is what lets an imageless token survive the join —
    // an INNER JOIN here would silently hide every token still missing a logo.
    expect(query.steps.some((step) => step.method === 'leftJoin')).toBe(true)
    expect(query.steps.some((step) => step.method === 'innerJoin')).toBe(true)
    expect(rows).toEqual([{ tokenId: 'token-1', imageHash: null }])
  })
})
