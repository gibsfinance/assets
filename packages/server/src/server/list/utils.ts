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
  list: { listId: string; name: string | null; imageHash: string | null; ext: string | null; mode: string | null; uri: string | null; updatedAt: string; major: number; minor: number; patch: number },
  filters: Filter<Network & Token>[] = [],
  extensions: Set<string>,
) => {
  let q = db.getTokensUnderListId().where(eq(s.listToken.listId, list.listId))
  if (extensions.has('bridgeInfo')) {
    q = db.addBridgeExtensions(q) as unknown as typeof q
  }
  if (extensions.has('headerUri')) {
    q = db.addHeaderUriExtension(q) as unknown as typeof q
  }
  const tokens = await q.orderBy(asc(s.listToken.listTokenOrderId))
  // could possibly be turned into a query
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
      .groupBy((tkn) => `${tkn.chainId}-${tkn.providedId.toLowerCase()}`)
      .reduce((collected, tkns) => {
        const tkn = tkns[0]
        const baseline: TokenEntryMetadataOptional = {
          chainId: +tkn.chainId,
          address: tkn.providedId.toLowerCase() as viem.Hex,
          logoURI: utils.directUri(tkn),
        }
        if (!extensions.has('sansMetadata')) {
          const b = baseline as TokenEntry
          b.name = tkn.name
          b.symbol = tkn.symbol
          b.decimals = tkn.decimals
        }
        // Debug: expose ranking info
        ;(baseline as any)._debug = Object.keys(tkn)
        // Collect unique source lists (providerKey/listKey) across duplicates
        const sources = _.uniq(
          tkns
            .filter((t) => t.providerKey && t.listKey)
            .map((t) => `${t.providerKey}/${t.listKey}`),
        )
        if (sources.length > 0) {
          baseline.sources = sources
        }
        if (showExtensions) {
          let everAddedExtension = false
          const extensions = _.reduce(
            tkns,
            (ext, tkn) => {
              if (bridgeInfoExtension) {
                if (tkn.bridge.bridgeId && viem.isAddress(tkn.providedId)) {
                  everAddedExtension = true
                  const networkNotSelf = +tkn.chainId === +tkn.networkA.chainId ? tkn.networkB : tkn.networkA
                  const tokenNotSelf =
                    viem.getAddress(tkn.providedId) === viem.getAddress(tkn.nativeToken.providedId)
                      ? tkn.bridgedToken
                      : tkn.nativeToken
                  const tokenIsNative = tokenNotSelf === tkn.nativeToken
                  ext.bridgeInfo![+networkNotSelf.chainId] = {
                    tokenAddress: tokenNotSelf.providedId as viem.Hex,
                    originationBridgeAddress: (tokenIsNative
                      ? tkn.bridge.foreignAddress
                      : tkn.bridge.homeAddress) as viem.Hex,
                    destinationBridgeAddress: (tokenIsNative
                      ? tkn.bridge.homeAddress
                      : tkn.bridge.foreignAddress) as viem.Hex,
                  }
                }
              }
              if (headerUriExtension) {
                ext.headerUri = utils.directUri({
                  ...tkn,
                  imageHash: tkn.headerImageHash,
                })
              }
              return ext
            },
            {
              bridgeInfo: {},
            } as Extensions,
          )
          if (everAddedExtension) {
            baseline.extensions = extensions
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
    const chainIdsQs = (Array.isArray(q.chainId) ? q.chainId : [q.chainId]).map((cId) => `${cId}`)
    const chainIds = new Set<string>(chainIdsQs)
    filters.push((a) => chainIds.has(`${a.chainId}`))
  }
  if (q.decimals) {
    const decimalsQs = _.toArray(q.decimals as string | string[])
    const decimals = new Set<number>(decimalsQs.map((d) => Number(d)))
    filters.push((a) => decimals.has(a.decimals))
  }
  return filters
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
