import * as db from '@/db'
import * as utils from '@/utils'
import { Response } from 'express'
import * as viem from 'viem'
import type { Image, List, Network, Token } from 'knex/types/tables'
import { Knex } from 'knex'
import { Extensions, TokenEntry, TokenEntryMetadataOptional, TokenInfo, TokenList } from '@/types'
import { tableNames } from '@/db/tables'
import _ from 'lodash'

export const applyVersion = (version: string, db: Knex.QueryBuilder) => {
  const [major, minor, patch] = version.split('.')
  return db.where('major', major).where('minor', minor).where('patch', patch)
}

export const respondWithList = async (
  res: Response,
  list: List & Image,
  filters: Filter<Network & Token>[] = [],
  extensions: Set<string>,
) => {
  let q = db.getTokensUnderListId().where(`${tableNames.listToken}.listId`, list.listId)
  if (extensions.has('bridgeInfo')) {
    q = db.addBridgeExtensions(q)
  }
  const tokens = await q
  // could possibly be turned into a query
  const tkns = normalizeTokens(tokens, filters, extensions)
  res.json({
    name: list.name || '',
    logoURI: utils.directUri(list),
    timestamp: list.updatedAt.toISOString(),
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
  const showExtensions = bridgeInfoExtension
  return [
    ..._(tokens)
      .filter((a) => over(a))
      .filter((tkn) => viem.isAddress(tkn.providedId))
      .groupBy((tkn) => `${tkn.chainId}-${viem.getAddress(tkn.providedId)}`)
      .reduce((collected, tkns) => {
        const tkn = tkns[0]
        const baseline: TokenEntryMetadataOptional = {
          chainId: +tkn.chainId,
          address: tkn.providedId as viem.Hex,
          logoURI: utils.directUri(tkn),
        }
        if (!extensions.has('sansMetadata')) {
          const b = baseline as TokenEntry
          b.name = tkn.name
          b.symbol = tkn.symbol
          b.decimals = tkn.decimals
        }
        if (showExtensions) {
          let everAddedExtension = false
          const extensions = _.reduce(
            tkns,
            (ext, tkn) => {
              if (bridgeInfoExtension) {
                if (tkn.bridge.bridgeId) {
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
