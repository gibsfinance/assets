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
  searchTokens,
} from './index'
import { SEARCH_CANDIDATE_CAP } from './search'
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

  it('reduces the ranking common-table-expression to the newest version of each list', async () => {
    // Superseded list versions are never able to change the answer — the ranking
    // already sorts major/minor/patch descending and DISTINCT ON keeps the first row —
    // but nothing stopped them being read, joined and sorted first. On Ethereum they
    // were 1,067,093 of 1,246,904 list_token rows, and dropping them took the query
    // from 23.3s to 10.5s against staging.
    //
    // The filter has to sit in the common-table-expression, not in the outer query.
    // The whole point is that these rows never reach the join and the two sorts; a
    // predicate applied after the DISTINCT ON would sort them and then discard them.
    harness.queueResult({ rows: [{ tokenId: 'token-1' }] })

    await getTokensByChainRanked('eip155-1', '0xorder' as never)

    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    expect(rendered).toContain('NOT EXISTS')
    expect(rendered.indexOf('NOT EXISTS')).toBeLessThan(rendered.indexOf('DISTINCT ON'))
    // Compared as a row, so a higher minor never loses to a lower one with the same
    // major. Comparing the parts independently would let 2.0.0 and 1.9.0 both survive.
    expect(rendered).toMatch(/\(newer\.major, newer\.minor, newer\.patch\) >/)
  })

  it('lets only a version that has finished collecting supersede an older one', async () => {
    // Collection commits the list row in discover() and writes its list_token rows in a
    // later phase, so a new version exists and is incomplete for as long as that phase
    // runs. On version number alone the unfinished row wins and takes the complete older
    // version out of the answer with it.
    //
    // Testing for tokens rather than for completion — which this did until the publish
    // marker existed — only covers the empty case. A version halfway through its writes
    // holds tokens, so it supersedes, and everything it has not rewritten yet goes
    // missing for as long as collection takes. That is tens of minutes on a large list.
    harness.queueResult({ rows: [{ tokenId: 'token-1' }] })

    await getTokensByChainRanked('eip155-1', '0xorder' as never)

    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    // The marker has to be read off the *newer* row. Testing the outer row instead would
    // silently invert this into "drop every list that has not finished collecting",
    // which would hide first-time lists entirely rather than serving them progressively.
    expect(rendered).toMatch(/newer\.tokens_collected_at IS NOT NULL/)
    // And it must remain a completion test, not a population test: a row can hold tokens
    // for tens of minutes before it is complete, which is the whole failure being closed.
    expect(rendered).not.toMatch(/FROM "list_token" member/)
  })

  it('omits the extension joins entirely when neither is requested', async () => {
    harness.queueResult({ rows: [{ tokenId: 'token-1' }] })

    await getTokensByChainRanked('eip155-1', '0xorder' as never)

    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    expect(rendered).not.toContain('bridge_link')
    expect(rendered).not.toContain('header_link')
  })

  it('joins the extension tables outside the DISTINCT ON so a token keeps every bridge link', async () => {
    // /list/merged accepted ?extensions= and answered without them, because the query
    // behind it joined neither the bridge tables nor header_link — against production
    // that was nothing with extensions there against 1290 on a provider list.
    //
    // The joins have to sit outside the DISTINCT ON subquery. Inside it, a token
    // bridged to several chains would keep one link and lose the rest, since
    // DISTINCT ON returns a single row per token. Outside, the ranking pick is already
    // settled and the fan-out is what normalizeTokens wants — it folds every row for
    // one address into that entry's bridgeInfo map.
    harness.queueResult({
      rows: [{ tokenId: 'token-1', bridge: null, bridgeLink: null, networkA: null, networkB: null }],
    })

    await getTokensByChainRanked('eip155-1', '0xorder' as never, { bridgeInfo: true, headerUri: true })

    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    expect(rendered).toContain('bridge_link')
    expect(rendered).toContain('header_link')
    // Every table in the bridge chain joins LEFT. An INNER anywhere along it would
    // drop every token that is not bridged, turning the extension request into a
    // silent filter over the whole chain.
    expect(rendered).not.toContain('INNER JOIN "bridge"')
    // The join, not the select-list reference to the same table — the column list is
    // emitted above the subquery, so only the join position says where it is applied.
    expect(rendered.indexOf('DISTINCT ON')).toBeLessThan(rendered.indexOf('LEFT JOIN "bridge_link"'))
  })

  it('camelCases the nested bridge columns only when bridgeInfo was requested', async () => {
    // row_to_json hands back the database's snake_case names; normalizeTokens reads
    // camelCase off these nested objects, so the conversion is what makes the
    // extension usable rather than merely present.
    harness.queueResult({
      rows: [
        {
          tokenId: 'token-1',
          bridge: { bridge_id: 'bridge-1', home_network_id: 'network-1' },
          bridgeLink: null,
          networkA: null,
          networkB: null,
          nativeToken: null,
          bridgedToken: null,
        },
      ],
    })

    const [row] = await getTokensByChainRanked('eip155-1', '0xorder' as never, { bridgeInfo: true })

    expect(row.bridge).toEqual({ bridgeId: 'bridge-1', homeNetworkId: 'network-1' })
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

  it('joins every bridge table with LEFT, so an unbridged token keeps its place in the list', async () => {
    // Production regression, and the sharpest kind: asking a list for an extension
    // emptied it. Only a minority of tokens are bridged, so `bridge_link` is null for
    // most rows; the chain below it was INNER, which drops a row outright rather than
    // returning it without bridge columns. /list/coingecko/base answered with 2238
    // tokens and, with ?extensions=bridgeInfo, with none at all — and did so silently,
    // as a 200. An extension adds fields to tokens; it must never remove tokens.
    harness.queueResult({ rows: [{ chainId: 'eip155-1' }] })

    await getTokensWithExtensions('list-1', { bridgeInfo: true })

    const rendered = renderSql((harness.queries[0].steps[0].args as unknown[])[0])
    const bridgeJoins = rendered.slice(rendered.indexOf('LEFT JOIN "bridge_link"'))
    for (const join of [
      '"bridge" ON',
      '"network" AS "network_a"',
      '"network" AS "network_b"',
      '"token" AS "native_token"',
      '"token" AS "bridged_token"',
    ]) {
      expect(bridgeJoins).toContain(`LEFT JOIN ${join}`)
    }
    // The assertion that actually holds the line: any INNER anywhere below
    // bridge_link re-introduces the bug, whatever it happens to be joining.
    expect(bridgeJoins).not.toContain('INNER JOIN')
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

  it('restricts membership to the newest version of each list', async () => {
    // This query names the lists a token is reported as belonging to, while
    // getTokensByChainRanked decides which tokens exist at all. They have to apply the
    // same version filter: if only the ranking query were filtered, a response could
    // still cite a source list for a token the ranking had already dropped, and if only
    // this one were, a token would arrive with no sources at all.
    harness.queueResult([{ providedId: '0xabc', providerKey: 'trustwallet', listKey: 'wallet' }])

    await getTokenSourcesByChain('eip155-1')

    const where = harness.queries[0].steps.find((step) => step.method === 'where')
    const rendered = renderSql((where?.args as unknown[])[0])
    expect(rendered).toContain('NOT EXISTS')
    expect(rendered).toContain('newer')
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

// ---------------------------------------------------------------------------
// searchTokens
// ---------------------------------------------------------------------------

describe('searchTokens', () => {
  /** The rendered text and bound parameters of the single query this issues. */
  const renderedSearch = () => {
    const fragment = (harness.queries[0].steps[0].args as unknown[])[0]
    return { sql: renderSql(fragment), params: sqlParams(fragment) }
  }

  /**
   * Just the `matched` expression — the part that reads only `token`.
   *
   * Sliced at the next expression's name rather than at a punctuation sequence, because
   * the rendered text carries the template's own newlines and indentation, so `), ` is
   * not literally present between them.
   */
  const matchedSection = (sql: string) => {
    const end = sql.indexOf('list_ranks AS')
    expect(end).toBeGreaterThan(-1)
    return sql.slice(0, end)
  }

  it('cuts the candidate set before anything joins to it', async () => {
    harness.queueResult({ rows: [] })

    await searchTokens('usdc', '0xorder' as never, { limit: 25 })

    const { sql, params } = renderedSearch()
    // The whole shape of this query. The LIMIT has to sit inside the `matched`
    // expression, which reads only `token`, so the per-candidate join that follows runs
    // over at most that many rows. Moved to the outer query it would still return the
    // right answer — after resolving the winning list entry for every token in the
    // table, which is the cost the cap exists to avoid.
    const matched = matchedSection(sql)
    expect(matched).toContain('LIMIT')
    expect(sql.indexOf('DISTINCT ON')).toBeGreaterThan(matched.length)
    expect(params).toContain(25)
  })

  it('scores popularity inside the candidate cut, not after it', async () => {
    harness.queueResult({ rows: [] })

    await searchTokens('usdc', '0xorder' as never)

    const matched = matchedSection(renderedSearch().sql)
    // The bug this pins cost the endpoint its usefulness. "usdc" matches 1,396 tokens
    // that nearly all carry the symbol USDC, so the relevance tier cannot separate them.
    // With the count applied only after the join, the cut kept the alphabetically first
    // candidates — the answer was "Anubis Bridged USDC (Anubis)" and USD Coin was never
    // a candidate at all. The count has to be computed and ordered on before the LIMIT.
    expect(matched).toContain('"listCount"')
    expect(matched.indexOf('"listCount" DESC')).toBeLessThan(matched.indexOf('LIMIT'))
  })

  it('orders by relevance, then popularity, then provider ranking', async () => {
    harness.queueResult({ rows: [] })

    await searchTokens('usdc', '0xorder' as never)

    const { sql } = renderedSearch()
    const final = sql.slice(sql.lastIndexOf('ORDER BY'))
    // Provider ranking last of the three on purpose: it orders providers, and a search
    // asks which token was meant. Promoting it above relevance would answer "pls" with
    // whatever the best-ranked list happens to hold rather than the token named PLS.
    expect(final.indexOf('b.tier')).toBeLessThan(final.indexOf('"listCount"'))
    expect(final.indexOf('"listCount"')).toBeLessThan(final.indexOf('"listRanking"'))
  })

  it('escapes pattern syntax in the term rather than passing it to ILIKE', async () => {
    harness.queueResult({ rows: [] })

    await searchTokens('%', '0xorder' as never)

    const { params } = renderedSearch()
    // Unescaped this becomes `%%%`, which matches every token on every chain — the
    // most expensive query the table can answer, from a one-character request.
    expect(params).toContain('%\\%%')
    expect(params).not.toContain('%%%')
  })

  it('matches an address exactly rather than as a substring', async () => {
    harness.queueResult({ rows: [] })

    await searchTokens('0xabc', '0xorder' as never)

    const { sql, params } = renderedSearch()
    // `provided_id` is citext, so equality is already case-insensitive. Making this a
    // LIKE instead would mean a short address prefix matched thousands of tokens and
    // the exact-address tier stopped meaning anything.
    expect(sql).toContain('"provided_id" = ')
    expect(params).toContain('0xabc')
    expect(params).toContain('%0xabc%')
  })

  it('joins network only when a chain is named', async () => {
    harness.queueResult({ rows: [] })
    await searchTokens('usdc', '0xorder' as never)
    // An unfiltered search is the common case, and the join would otherwise be paid on
    // every request to answer a question nobody asked.
    expect(matchedSection(renderedSearch().sql)).not.toContain('"network"')

    harness.reset()
    harness.queueResult({ rows: [] })
    await searchTokens('usdc', '0xorder' as never, { chainId: 'eip155-369' })
    const scoped = renderedSearch()
    expect(matchedSection(scoped.sql)).toContain('"network"')
    expect(scoped.params).toContain('eip155-369')
  })

  it('reduces the ranking expression to the newest completed version of each list', async () => {
    harness.queueResult({ rows: [] })

    await searchTokens('usdc', '0xorder' as never)

    const { sql } = renderedSearch()
    // Shared with the chain-scoped queries and load-bearing for the same reason: a
    // version still being collected must not supersede the complete one beside it, or
    // every token it has not rewritten yet vanishes from search for the duration.
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toMatch(/newer\.tokens_collected_at IS NOT NULL/)
  })

  it('prefers a list entry whose image resolves when picking the winner for a token', async () => {
    harness.queueResult({ rows: [] })

    await searchTokens('usdc', '0xorder' as never)

    const { sql } = renderedSearch()
    // Same preference getTokensByChainRanked applies. Without it a token can win on
    // ranking through a list entry that carries no usable image, and the search result
    // renders as a blank tile for a token that does have a logo elsewhere.
    expect(sql).toContain("= 'link'")
    expect(sql.indexOf('DISTINCT ON')).toBeLessThan(sql.indexOf("= 'link'"))
  })

  it('defaults the candidate limit rather than issuing an unbounded query', async () => {
    harness.queueResult({ rows: [] })

    await searchTokens('usdc', '0xorder' as never)

    expect(renderedSearch().params).toContain(SEARCH_CANDIDATE_CAP)
  })

  it('returns the rows the database produced', async () => {
    harness.queueResult({ rows: [{ symbol: 'USDC' }] })
    const rows = await searchTokens('usdc', '0xorder' as never)
    expect(rows).toEqual([{ symbol: 'USDC' }])
  })
})
