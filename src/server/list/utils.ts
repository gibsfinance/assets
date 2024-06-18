import * as db from '@/db'
import * as utils from '@/utils'
import { Response } from 'express'
import { Image, List } from 'knex/types/tables'
import { Knex } from 'knex'
import { TokenInfo } from '@/types'
import { tableNames } from '@/db/tables'

export const applyVersion = (version: string, db: Knex.QueryBuilder) => {
  const [major, minor, patch] = version.split('.')
  return db.where('major', major)
    .where('minor', minor)
    .where('patch', patch)
}

export const respondWithList = async (res: Response, list: List & Image) => {
  const tokens = await db.getTokensUnderListId()
    .where(`${tableNames.listToken}.listId`, list.listId)

  // could possibly be turned into a query
  res.json({
    name: list.name,
    description: list.description,
    logoURI: utils.directUri(list),
    timestamp: list.updatedAt,
    version: {
      major: list.major,
      minor: list.minor,
      patch: list.patch,
    },
    tokens: normalizeTokens(tokens),
  })
}

export const normalizeTokens = (tokens: TokenInfo[]) => tokens.map((tkn) => ({
  chainId: tkn.chainId,
  address: tkn.providedId || tkn.address,
  name: tkn.name,
  symbol: tkn.symbol,
  decimals: tkn.decimals,
  logoURI: utils.directUri(tkn),
}))
