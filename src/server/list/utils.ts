import * as db from '@/db'
import * as utils from '@/utils'
import { Response } from 'express'
import * as viem from 'viem'
import { Bridge, BridgeLink, Image, List, Network, Token } from 'knex/types/tables'
import { Knex } from 'knex'
import { Extensions, TokenEntry, TokenInfo, TokenList } from '@/types'
import { tableNames } from '@/db/tables'
import type { ParsedQs } from 'qs'
import _ from 'lodash'

export const applyVersion = (version: string, db: Knex.QueryBuilder) => {
  const [major, minor, patch] = version.split('.')
  return db.where('major', major).where('minor', minor).where('patch', patch)
}

export const respondWithList = async (
  res: Response, list: List & Image,
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
): TokenEntry[] => {
  const over = _.overEvery(filters)
  const bridgeInfoExtension = extensions.has('bridgeInfo')
  const showExtensions = bridgeInfoExtension
  // console.log(tokens.filter((t) => t.chainId === '369' && t.providedId === '0xE41d2489571d322189246DaFA5ebDe1F4699F498' || t.providedId === '0x8B6d72bc8E218747b6C18ed2dd4200414CfE137c')[0])
  return [..._(tokens)
    .filter((a) => over(a))
    .groupBy((tkn) => `${tkn.chainId}-${viem.getAddress(tkn.providedId)}`)
    .reduce((collected, tkns) => {
      const tkn = tkns[0]
      const baseline = {
        chainId: +tkn.chainId,
        address: tkn.providedId as viem.Hex,
        name: tkn.name,
        symbol: tkn.symbol,
        decimals: tkn.decimals,
        logoURI: utils.directUri(tkn),
      } as TokenEntry
      if (showExtensions) {
        let everAddedExtension = false
        const extensions = _.reduce(tkns, (ext, tkn) => {
          if (bridgeInfoExtension) {
            if (tkn.bridge.bridgeId) {
              everAddedExtension = true
              const networkNotSelf = +tkn.chainId === +tkn.networkA.chainId
                ? tkn.networkB
                : tkn.networkA
              const tokenNotSelf = viem.getAddress(tkn.providedId) === viem.getAddress(tkn.nativeToken.providedId)
                ? tkn.bridgedToken
                : tkn.nativeToken
              const tokenIsNative = tokenNotSelf === tkn.nativeToken
              ext.bridgeInfo![+networkNotSelf.chainId] = {
                tokenAddress: tokenNotSelf.providedId as viem.Hex,
                originationBridgeAddress: (tokenIsNative ? tkn.bridge.foreignAddress : tkn.bridge.homeAddress) as viem.Hex,
                destinationBridgeAddress: (tokenIsNative ? tkn.bridge.homeAddress : tkn.bridge.foreignAddress) as viem.Hex,
              }
            }
          }
          return ext
        }, {
          bridgeInfo: {},
        } as Extensions)
        if (everAddedExtension) {
          baseline.extensions = extensions
        }
      }
      collected.set(uniqueTokenKey(baseline), baseline)
      return collected
    }, new Map())
    .values()]
}

const uniqueTokenKey = (info: { chainId: number; address: viem.Hex }) => (
  `${info.chainId}-${info.address}`
)

type Filter<T> = (a: T) => boolean

export const tokenFilters = (q: ParsedQs) => {
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

export const minimalList = (tokens: TokenEntry[]): TokenList => {
  return {
    name: '',
    timestamp: new Date().toISOString(),
    version: {
      major: 0,
      minor: 0,
      patch: 0,
    },
    tokens,
  }
}
