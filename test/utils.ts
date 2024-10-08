import * as db from '../src/db'
import type { InsertableListToken, List, ListToken, Network, Provider, Token } from 'knex/types/tables'
import * as viem from 'viem'
import _ from 'lodash'
import { TableNames, Tx, tableNames } from '../src/db/tables'

const inserted: Partial<Record<TableNames, any[]>> = {
  network: [] as Network[],
  provider: [] as Provider[],
  list: [] as List[],
  token: [] as Token[],
  list_token: [] as ListToken[],
}

export const get = (key: TableNames, index = 0) => {
  return inserted[key]?.[index]
}

export const teardown = async () => {
  const providerIds = inserted.provider!.map(({ providerId }) => providerId)
  const networkIds = inserted.network!.map(({ networkId }) => networkId)
  await db.transaction(async (tx) => {
    await tx.from(tableNames.provider).delete().whereIn('providerId', providerIds)
    await tx.from(tableNames.network).delete().whereIn('networkId', networkIds)
  })
}

const insert = async <T = any>(list: T[], count: number, fn: (i: number, tx: Tx) => Promise<T>, t: Tx = db.getDB()) => {
  const len = list.length
  await t.transaction(async (tx) => {
    for (let i = 0; i < count; i++) {
      const res = await fn(i, tx)
      if (Array.isArray(res)) list.push(...res)
      else list.push(res)
    }
  })
  return list.slice(len)
}

export const setup = async () => {
  await db.transaction(async (t) => {
    const providers = await insert(
      inserted.provider!,
      4,
      (i, tx) =>
        db.insertProvider(
          {
            name: 'Provider ABC' + i,
            key: 'provider-abc' + i,
          },
          tx,
        ),
      t,
    )
    const networks = await insert(inserted.network!, 3, (i, tx) => db.insertNetworkFromChainId(i, 'test', tx), t)
    const providerToList = new Map<string, List[]>()
    for (const [pI, provider] of Object.entries(providers)) {
      const lists = await insert(
        inserted.list!,
        3,
        (i, tx) =>
          db.insertList(
            {
              providerId: provider.providerId,
              key: 'list-abc' + i,
              default: +pI === i,
            },
            tx,
          ),
        t,
      )
      providerToList.set(provider.providerId, lists)
    }
    const tokensUnderNetworkId = new Map<string, Token[]>()
    for (const network of networks) {
      const tokens = await insert(
        inserted.token!,
        5,
        (i, tx) =>
          db.insertToken(
            {
              providedId: providedId(network.chainId, i),
              symbol: 'ETH' + i,
              name: 'Ether' + i,
              decimals: i % 3 === 1 ? 8 : 18,
              networkId: network.networkId,
            },
            tx,
          ),
        t,
      )
      tokensUnderNetworkId.set(network.networkId, tokens)
    }
    const listTokens: InsertableListToken[] = []
    for (const lists of providerToList.values()) {
      for (const list of lists) {
        for (const tokens of tokensUnderNetworkId.values()) {
          for (const token of tokens) {
            listTokens.push({
              tokenId: token.tokenId,
              listId: list.listId,
            })
          }
        }
      }
    }
    await insert(inserted.list_token!, 1, (_i, tx) => db.insertListToken(listTokens, tx), t)
    // await db.insertListToken({
    //   providedId: token0.providedId,
    //   networkId: token0.networkId,
    //   listId: list1.listId,
    // })
    // await db.insertListToken({
    //   providedId: token1.providedId,
    //   networkId: token1.networkId,
    //   listId: list1.listId,
    // })
  })
}

export const providedId = (chainId: number, i: number) =>
  viem.padHex(viem.toHex(new Uint8Array([+chainId, i])), {
    size: 20,
    dir: 'left',
  })
