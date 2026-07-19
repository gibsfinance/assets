/**
 * @module list/utils
 * Token list response formatting and query param filtering.
 *
 * `normalizeTokens()` deduplicates token results by chainId+address, preserving
 * input order (first occurrence wins). Optionally collects `sources` (providerKey/listKey)
 * and bridge/header extensions across duplicate entries.
 *
 * `tokenFilters()` parses `?chainId=` and `?decimals=` query params into predicate functions.
 */
import createError from 'http-errors'
import { fromCAIP2 } from '../../chain-id'
import * as db from '../../db'
import * as utils from '../../utils'
import { Response } from 'express'
import * as viem from 'viem'
import type { Network, Token } from '../../db/schema-types'
import { Extensions, TokenEntry, TokenEntryMetadataOptional, TokenInfo, TokenList } from '../../types'
import _ from 'lodash'
import config from '../../../config'
import { eq, asc } from 'drizzle-orm'
import * as s from '../../db/schema'

export const respondWithList = async (
  res: Response,
  list: {
    listId: string
    name: string | null
    imageHash: string | null
    ext: string | null
    mode: string | null
    uri: string | null
    updatedAt: string
    major: number
    minor: number
    patch: number
  },
  filters: Filter<Network & Token>[] = [],
  extensions: Set<string>,
) => {
  const hasBridge = extensions.has('bridgeInfo')
  const hasHeader = extensions.has('headerUri')
  const tokens =
    hasBridge || hasHeader
      ? await db.getTokensWithExtensions(list.listId, { bridgeInfo: hasBridge, headerUri: hasHeader })
      : await db
          .getTokensUnderListId()
          .where(eq(s.listToken.listId, list.listId))
          .orderBy(asc(s.listToken.listTokenOrderId))
  const tkns = normalizeTokens(tokens as unknown as TokenInfo[], filters, extensions)
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.json({
    name: list.name || '',
    logoURI: utils.directUri(list as any),
    timestamp: new Date(list.updatedAt).toISOString(),
    version: {
      major: list.major || 0,
      minor: list.minor || 0,
      patch: list.patch || 0,
    },
    tokens: tkns,
  } as TokenList)
}

export const normalizeTokens = (
  tokens: TokenInfo[],
  filters: Filter<Network & Token>[] = [],
  extensions: Set<string> = new Set(),
): TokenEntryMetadataOptional[] => {
  const over = _.overEvery(filters)
  const bridgeInfoExtension = extensions.has('bridgeInfo')
  const headerUriExtension = extensions.has('headerUri')
  const showExtensions = bridgeInfoExtension || headerUriExtension
  return [
    ..._(tokens)
      .filter((a) => over(a))
      // normalizeProvidedId lowercases only hex addresses; base58 ids (Solana, Tron)
      // are case-significant and preserved. A bare .toLowerCase() would merge distinct
      // base58 mints and, at the address below, hand back a corrupted id.
      .groupBy((tkn) => `${tkn.chainId}-${db.normalizeProvidedId(tkn.providedId)}`)
      .reduce((collected, tkns) => {
        // When duplicate tokens share the same address (different token_ids), prefer
        // the row that resolves to a usable logoURI so the address isn't dropped by
        // the downstream logoURI filter just because tkns[0] happened to lack an image.
        // Counterpart of the image-first ORDER BY in getTokensByChainRanked (db/index.ts,
        // usableImageSql): rows arrive in each path's ranking order, so "first usable
        // image" here and "image-first, then ranking" there pick the same winner. If
        // the SQL preference changes, revisit this pick.
        const tkn = tkns.find((t) => utils.directUri(t)) ?? tkns[0]
        const baseline: TokenEntryMetadataOptional = {
          chainId: +fromCAIP2(tkn.chainId),
          address: db.normalizeProvidedId(tkn.providedId) as viem.Hex,
          logoURI: utils.directUri(tkn),
        }
        if (!extensions.has('sansMetadata')) {
          const b = baseline as TokenEntry
          b.name = tkn.name
          b.symbol = tkn.symbol
          b.decimals = tkn.decimals
        }
        // Collect unique source lists (providerKey/listKey) across duplicates
        const sources = _.uniq(
          tkns.filter((t) => t.providerKey && t.listKey).map((t) => `${t.providerKey}/${t.listKey}`),
        )
        if (sources.length > 0) {
          baseline.sources = sources
        }
        if (showExtensions) {
          const collectedExtensions = _.reduce(
            tkns,
            (ext, tkn) => {
              if (bridgeInfoExtension && tkn.bridge?.bridgeId && viem.isAddress(tkn.providedId)) {
                // Row chain ids are prefixed (eip155-369) — numeric coercion without
                // fromCAIP2 yields NaN, which both broke the self-network comparison
                // and emitted literal "NaN" bridgeInfo keys in production output.
                const selfChainId = +fromCAIP2(`${tkn.chainId}`)
                const networkNotSelf =
                  selfChainId === +fromCAIP2(`${tkn.networkA.chainId}`) ? tkn.networkB : tkn.networkA
                const tokenNotSelf =
                  viem.getAddress(tkn.providedId) === viem.getAddress(tkn.nativeToken.providedId)
                    ? tkn.bridgedToken
                    : tkn.nativeToken
                const tokenIsNative = tokenNotSelf === tkn.nativeToken
                ext.bridgeInfo![+fromCAIP2(`${networkNotSelf.chainId}`)] = {
                  tokenAddress: tokenNotSelf.providedId as viem.Hex,
                  originationBridgeAddress: (tokenIsNative
                    ? tkn.bridge.foreignAddress
                    : tkn.bridge.homeAddress) as viem.Hex,
                  destinationBridgeAddress: (tokenIsNative
                    ? tkn.bridge.homeAddress
                    : tkn.bridge.foreignAddress) as viem.Hex,
                }
              }
              if (headerUriExtension) {
                const headerUri = utils.directUri({
                  ...tkn,
                  imageHash: tkn.headerImageHash,
                })
                if (headerUri) ext.headerUri = headerUri
              }
              return ext
            },
            {
              bridgeInfo: {},
            } as Extensions,
          )
          // Attach extensions whenever anything was collected. headerUri counts on
          // its own — it used to require a bridgeInfo hit in the same group, so
          // headerUri-only requests never received their extensions.
          if (_.isEmpty(collectedExtensions.bridgeInfo)) {
            delete collectedExtensions.bridgeInfo
          }
          if (!_.isEmpty(collectedExtensions)) {
            baseline.extensions = collectedExtensions
          }
        }
        collected.set(uniqueTokenKey(baseline), baseline)
        return collected
      }, new Map())
      .values(),
  ]
}

const uniqueTokenKey = (info: { chainId: number; address: viem.Hex }) => `${info.chainId}-${info.address}`

type Filter<T> = (a: T) => boolean

export const tokenFilters = (q: { chainId?: number | string | string[]; decimals?: number | string | string[] }) => {
  const filters: Filter<Token & Network>[] = []
  if (q.chainId) {
    // Compare on the bare reference, not the prefixed id. Normalizing both sides
    // through toCAIP2 matched only by symmetry: a bare ?chainId=369 became
    // eip155-369 on both sides and worked, but an explicit ?chainId=solana-501
    // became solana-501 while every row had already been flattened to the number
    // 501 (normalizeTokens emits `+fromCAIP2(chainId)`, since the token-list format
    // types chainId as a number), so it matched nothing.
    //
    // The flattening is why this cannot distinguish solana-501 from eip155-501 —
    // by the time a filter runs, that distinction is gone from the data. Matching on
    // the reference is the honest version of what this already did.
    const references = new Set<string>(
      (Array.isArray(q.chainId) ? q.chainId : [q.chainId]).map((cId) => fromCAIP2(`${cId}`)),
    )
    filters.push((a) => references.has(fromCAIP2(`${a.chainId}`)))
  }
  if (q.decimals) {
    const decimalsQs = (Array.isArray(q.decimals) ? q.decimals : [q.decimals]).map((d) => `${d}`)
    const decimals = new Set<number>(decimalsQs.map((d) => Number(d)))
    filters.push((a) => decimals.has(a.decimals))
  }
  return filters
}

/**
 * Parses an `?extensions=` query value into a set of extension names.
 * Accepts both the repeated-parameter form (`extensions=a&extensions=b`) and
 * the documented comma-separated form (`extensions=a,b`) — the latter used to
 * arrive as the single literal name "a,b" and silently match nothing.
 */
export const parseExtensions = (raw: unknown): Set<string> => {
  if (!raw) return new Set<string>()
  const values = Array.isArray(raw) ? raw : [raw]
  return new Set(
    values
      .flatMap((value) => `${value}`.split(','))
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

/**
 * Clamps a `?limit=` query value into [1, max].
 * Non-numeric, zero, and negative inputs fall back to the default — a negative
 * limit must never reach Array.prototype.slice (slice(0, -n) drops tokens from
 * the end) and every distinct accepted limit becomes a cache key, so junk
 * values would otherwise fragment the cache.
 */
export const parseTokenLimit = (raw: unknown, options: { fallback: number; max: number }): number => {
  const value = Math.floor(Number(raw))
  if (!Number.isFinite(value) || value < 1) return options.fallback
  return Math.min(value, options.max)
}

/**
 * Validates and normalizes GET /list/ query filters at the boundary so
 * malformed values fail fast with 400 instead of surfacing as opaque Postgres
 * errors (500). Boolean and integer columns reject non-coercible strings;
 * chain ids are normalized to the prefixed form the network table stores.
 *
 * @throws {createError.HttpError} 400 when a value is empty or not coercible
 *   to its column type.
 */
export const parseListFilters = (query: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {}
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined) continue
    const values = Array.isArray(rawValue) ? rawValue : [rawValue]
    const parsed = values.map((value) => {
      if (typeof value !== 'string' || value === '') {
        throw createError.BadRequest(`filter "${key}" must be a non-empty string`)
      }
      return parseListFilterValue(key, value)
    })
    normalized[key] = Array.isArray(rawValue) ? parsed : parsed[0]
  }
  return normalized
}

const INTEGER_LIST_FILTERS = new Set(['major', 'minor', 'patch'])

const parseListFilterValue = (key: string, value: string): unknown => {
  if (key === 'default') {
    if (value !== 'true' && value !== 'false') {
      throw createError.BadRequest(`filter "default" must be "true" or "false", got "${value}"`)
    }
    return value === 'true'
  }
  if (key === 'chain_id') {
    // Left bare on purpose. toCAIP2 here turned ?chain_id=501 into eip155-501 and
    // then matched it with equality, so lists on solana-501 were unreachable by
    // number. getFilteredLists compares a bare value against the stored id's
    // reference instead, and an explicit id still matches exactly.
    return value
  }
  if (INTEGER_LIST_FILTERS.has(key)) {
    if (!/^\d+$/.test(value)) {
      throw createError.BadRequest(`filter "${key}" must be a non-negative integer, got "${value}"`)
    }
    return Number(value)
  }
  return value
}

export const minimalList = (tokens: TokenEntryMetadataOptional[]): TokenList => {
  return {
    name: '',
    timestamp: new Date().toISOString(),
    version: {
      major: 0,
      minor: 0,
      patch: 0,
    },
    tokens: tokens as TokenEntry[],
  }
}
