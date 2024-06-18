import * as db from '@/db'
import * as utils from '@/utils'
import { Response } from 'express'
import * as viem from 'viem'
import { Image, List, Network, Token } from 'knex/types/tables'
import { Knex } from 'knex'
import { TokenEntry, TokenInfo, TokenList } from '@/types'
import { tableNames } from '@/db/tables'
import type { ParsedQs } from 'qs'
import _ from 'lodash'

export const applyVersion = (version: string, db: Knex.QueryBuilder) => {
  const [major, minor, patch] = version.split('.')
  return db.where('major', major)
    .where('minor', minor)
    .where('patch', patch)
}

export const respondWithList = async (
  res: Response, list: List & Image,
  filters: Filter<Network & Token>[] = [],
) => {
  const tokens = await db.getTokensUnderListId()
    .where(`${tableNames.listToken}.listId`, list.listId)

  // could possibly be turned into a query
  const tkns = normalizeTokens(tokens, filters)
  res.json({
    name: list.name,
    description: list.description,
    logoURI: utils.directUri(list),
    timestamp: list.updatedAt,
    version: {
      major: list.major || 0,
      minor: list.minor || 0,
      patch: list.patch || 0,
    },
    tokens: tkns,
  })
}

export const normalizeTokens = (
  tokens: TokenInfo[], filters: Filter<Network & Token>[] = [],
): TokenEntry[] => {
  const over = _.overEvery(filters)
  return _(tokens)
    .filter((a) => over(a))
    .map((tkn) => ({
      chainId: +tkn.chainId,
      address: tkn.providedId as viem.Hex,
      name: tkn.name,
      symbol: tkn.symbol,
      decimals: tkn.decimals,
      logoURI: utils.directUri(tkn),
    }))
    .value()
}

type Filter<T> = (a: T) => boolean

export const tokenFilters = (q: ParsedQs) => {
  const filters: Filter<Token & Network>[] = []
  console.log(q)
  if (q.chainId) {
    const chainIdsQs = (Array.isArray(q.chainId) ? q.chainId : [q.chainId]).map((cId) => `${cId}`)
    const chainIds = new Set<string>(chainIdsQs)
    console.log(chainIds)
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
    timestamp: (new Date()).toISOString(),
    version: {
      major: 0,
      minor: 0,
      patch: 0,
    },
    tokens,
  }
}
