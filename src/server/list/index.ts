import { Response, Router } from 'express'
import * as db from '@/db'
import createError from 'http-errors'
import * as utils from '@/utils'
import { tableNames } from '@/db/tables'
import { Image, List, ListToken, Provider } from 'knex/types/tables'
import { Knex } from 'knex'
import * as semver from 'semver'

export const router = Router()

const parsePiece = (piece: string) => {
  const operators = ['>=', '<=', '>', '<', '~', '^']
  const any = piece === 'x' || piece === '*'
  if (any) {
    return {
      valid: true,
      value: piece,
      any: true,
      operator: null,
    }
  }
  let short!: string
  let operator!: string
  for (const o of operators) {
    const split = piece.split(o)
    if (split.length > 1) {
      const [a, b] = split
      operator = o
      if (operator === a) {
        short = b
      } else {
        short = a
      }
      break
    }
  }
  return {
    valid: !(+short === +short),
    any: false,
    value: +short,
    operator,
  }
}

const parseVersion = (version: string) => {
  const noV = version.split('v').join('')
  const pieces = noV.split('.')
  if (pieces.length > 3) {
    return
  }
  return pieces.map((piece) => {
    const asNum = +piece
    if (asNum === asNum) return (q: Knex.QueryBuilder, k: string) => q.where(k, asNum)
    const parsed = parsePiece(piece)
    return (q: Knex.QueryBuilder, k: string) => {
      if (!parsed.valid || parsed.any) return q
      if (parsed.operator) return q.where(k, parsed.operator, parsed.value)
      return q.where(k, parsed.value)
    }
  })
}

const applyVersion = (version: string, db: Knex.QueryBuilder) => {
  const [major, minor, patch] = version.split('.')
  return db.where('major', major)
    .where('minor', minor)
    .where('patch', patch)
}

router.get('/:providerKey/:listKey/:version', async (req, res, next) => {
  const list = await applyVersion(req.params.version, db.getList(
    req.params.providerKey,
    req.params.listKey
  ))
  if (!list) {
    return next(createError.NotFound())
  }
  await respondWithList(res, list)
})

router.get('/:providerKey/:listKey?', async (req, res, next) => {
  const list = await db.getList(
    req.params.providerKey,
    req.params.listKey
  )
  if (!list) {
    return next(createError.NotFound())
  }
  await respondWithList(res, list)
})

const respondWithList = async (res: Response, list: List & Image) => {
  const tokens = await db.getTokensUnderListId(list.listId)

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
    tokens: tokens.map((tkn) => ({
      chainId: tkn.chainId,
      address: tkn.address,
      name: tkn.name,
      symbol: tkn.symbol,
      decimals: tkn.decimals,
      logoURI: utils.directUri(tkn),
    }))
  })
}
