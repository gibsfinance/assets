import knex, { type Knex } from 'knex'
import * as fs from 'fs'
import * as path from 'path'
import * as types from '../types'
import * as viem from 'viem'
import { config } from './config'
import * as fileType from 'file-type'
import * as utils from '../utils'
import { Tx, tableNames } from './tables'
import type {
  Image,
  InsertableList,
  InsertableListToken,
  InsertableProvider,
  InsertableToken,
  Link,
  List,
  ListToken,
  Network,
  Provider,
  ListOrder,
  ListOrderItem,
  InsertableListOrder,
  BackfillableInsertableListOrderItem,
  Token,
  InsertableBridge,
  Bridge,
  InsertableBridgeLink,
  BridgeLink,
  Metadata,
} from 'knex/types/tables'
import { fetch } from '@/fetch'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import { join } from './utils'

export const ids = {
  provider: (key: string) => viem.keccak256(viem.toBytes(key)).slice(2),
  list: ({
    providerId,
    key,
    major,
    minor,
    patch,
  }: {
    providerId: string
    key: string
    major: number
    minor: number
    patch: number
  }) => utils.toKeccakBytes(`${providerId}${key}${major}${minor}${patch}`),
}

let db = knex(config)

export const getDB = () => db

export const setDB = (k: Knex) => {
  db = k
}

type Transact<T> = typeof db.transaction<T>

export const transaction = async <T>(...a: Parameters<Transact<T>>) => db.transaction(...a)

const getExt = async (image: Buffer, providedExt: string) => {
  const e = await fileType.fileTypeFromBuffer(Uint8Array.from(image))
  let ext = e && e.ext ? `.${e.ext}` : null
  if (ext) {
    if (ext === '.xml' && providedExt !== ext) {
      ext = providedExt
    }
    return ext
  }
  return image.toString().split('<').length > 2 ? '.svg' : null
}

const missingInfoPath = ({
  imageHash,
  originalUri,
  providerKey,
  listId,
}: {
  imageHash?: string
  originalUri: string
  providerKey: string
  listId: string | null
}) => {
  const hash = imageHash || viem.keccak256(viem.toBytes(originalUri)).slice(2)
  return path.join(utils.root, 'missing', providerKey, `${listId}`, hash)
}

const limit1 = promiseLimit(1)

const removeMissing = async ({
  imageHash,
  originalUri,
  providerKey,
  listId,
}: {
  imageHash: string
  originalUri: string
  providerKey: string
  listId: string | null
}) => {
  const rf = {
    recursive: true,
    force: true,
  }
  await limit1(
    async () =>
      await Promise.all([
        fs.promises.rm(missingInfoPath({ imageHash, originalUri, providerKey, listId }), rf),
        fs.promises.rm(missingInfoPath({ originalUri, providerKey, listId }), rf),
      ]),
  )
}

const writeMissing = async ({
  providerKey,
  originalUri,
  imageHash,
  image,
  listId,
}: {
  providerKey: string
  originalUri: string
  listId: string | null
  imageHash?: string
  image?: Buffer
}) => {
  if (process.env.PREVENT_WRITE_MISSING) return
  const folder = missingInfoPath({ imageHash, originalUri, providerKey, listId })
  await limit1(async () => {
    await fs.promises.mkdir(folder, {
      recursive: true,
    })
    utils.failureLog('ext missing %o %o', originalUri, folder)
    await Promise.all([
      fs.promises.writeFile(
        path.join(folder, 'info.json'),
        JSON.stringify({
          imageHash,
          originalUri,
          providerKey,
          listId,
        }),
      ),
      image && fs.promises.writeFile(path.join(folder, 'icon'), Uint8Array.from(image)),
    ])
  })
}

export const insertImage = async (
  {
    providerKey,
    originalUri,
    image,
    listId,
  }: {
    providerKey: string
    originalUri: string
    listId: string | null
    image: Buffer
  },
  t: Tx = db,
) => {
  const imageHash = viem.keccak256(Uint8Array.from(image)).slice(2)
  const ext = await getExt(image, path.extname(originalUri))
  if (!ext) {
    utils.failureLog('no ext %o -> %o', providerKey, originalUri)
    await writeMissing({
      providerKey,
      originalUri,
      imageHash,
      image,
      listId,
    })
    return null
  }
  const [, [inserted]] = await Promise.all([
    removeMissing({
      imageHash,
      originalUri,
      providerKey,
      listId,
    }),
    t
      .from(tableNames.image)
      .insert({
        content: image,
        ext,
      })
      .onConflict(['imageHash'])
      .merge(['imageHash'])
      .returning<Image[]>(['ext', 'imageHash']),
  ])
  const [link] = await t
    .from(tableNames.link)
    .insert([
      {
        uri: originalUri,
        imageHash: inserted.imageHash,
      },
    ])
    .onConflict(['uri'])
    .merge(['uri'])
    .returning<Link[]>('*')
  return {
    image: inserted,
    link,
  }
}

export const fetchImage = async (url: string | Buffer, providerKey: string | null = null) => {
  if (Buffer.isBuffer(url)) {
    return url
  }
  if (!url) {
    return null
  }
  if (url.startsWith(utils.submodules)) {
    return fs.promises.readFile(url).catch(() => {
      utils.failureLog('read file failed %o -> %o', providerKey, url)
      return null
    })
  }
  let innerTimeout!: utils.Timeout
  const outerTimeout = utils.timeout(10_000)
  const result = await Promise.race([
    outerTimeout.promise.then(() => null),
    fetch(url)
      .then(utils.responseToBuffer)
      .catch(async () => {
        innerTimeout = utils.timeout(3_000)
        await innerTimeout.promise
        return await fetch(url).then(utils.responseToBuffer)
      })
      .catch((err: Error) => {
        utils.failureLog('fetch failure %o -> %o', providerKey, url)
        const errStr = err.toString()
        if (errStr.includes('This operation was abort')) {
          return null
        }
        if (errStr.includes('Invalid URL')) {
          return null
        }
        utils.failureLog(err)
        return null
      }),
  ])
  clearTimeout(outerTimeout.timeoutId())
  if (innerTimeout) {
    clearTimeout(innerTimeout.timeoutId())
  }
  return result
}

export const insertNetworkFromChainId = async (chainId: types.ChainId, type = 'evm', t: Tx = db) => {
  const [network] = await t
    .from(tableNames.network)
    .insert({
      type,
      chainId: chainId.toString(),
    })
    .onConflict(['networkId'])
    .merge(['networkId'])
    .returning<Network[]>('*')
  return network
}

export const insertToken = async (token: InsertableToken, t: Tx = db) => {
  const [inserted] = await t
    .from(tableNames.token)
    .insert({
      ...token,
      name: token.name.split('\x00').join(''),
      symbol: token.symbol.split('\x00').join(''),
    })
    .onConflict(['tokenId'])
    .merge(['tokenId'])
    .returning<Token[]>('*')
  return inserted
}

export const getImageFromLink = async (uri: string, t: Tx = db) => {
  const link = await t.from(tableNames.link).select('*').where('uri', uri).first<Link>()
  if (!link) return null
  const image = await t.from(tableNames.image).select('*').where('imageHash', link.imageHash).first<Image>()
  if (!image) return null
  return {
    link,
    image,
  }
}

export const getImageByAddress = async (
  { chainId, address, providerId }: { chainId: number; address: string; providerId?: string },
  t: Tx = db,
) => {
  const network = await t.from(tableNames.network).select('*').where('chainId', chainId).first<Network>()
  if (!network) return null
  const token = await t
    .from(tableNames.token)
    .select('*')
    .where('providedId', address)
    .where('networkId', network.networkId)
    .first<Token>()
  const listTokens = await t(tableNames.listToken)
    .select('*')
    .join(tableNames.list, {
      [`${tableNames.list}.listId`]: `${tableNames.listToken}.listId`,
    })
    .where('tokenId', token.tokenId)
    .where(`${tableNames.list}.providerId`, providerId)
    .first<ListToken & List>()
  return { token, listTokens }
}

export const fetchImageAndStoreForList = async (
  {
    listId,
    uri,
    originalUri,
    providerKey,
  }: {
    listId: string
    uri: string | Buffer | null
    originalUri: string | null
    providerKey: string
  },
  t: Tx = db,
) => {
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
  }
  if (_.isString(uri)) {
    const existing = await getImageFromLink(uri, t)
    if (existing) {
      const list = await getListFromId(listId, t)
      if (list && list.imageHash && list.imageHash === existing.image.imageHash) {
        return {
          ...existing,
          list,
        }
      }
    }
  }
  if (!uri || !originalUri) {
    const list = await getListFromId(listId, t)
    return {
      list,
    }
  }
  const image = await fetchImage(uri, providerKey)
  if (!image) {
    utils.failureLog('no img %o -> %o', providerKey, originalUri)
    await writeMissing({
      providerKey,
      originalUri,
      listId,
    })
    return
  }
  const img = await insertImage(
    {
      originalUri,
      image,
      providerKey,
      listId,
    },
    t,
  )
  if (!img) {
    return
  }
  const [list] = await t
    .from(tableNames.list)
    .update('imageHash', img.image.imageHash)
    .where('listId', listId)
    .returning<List[]>('*')
  return {
    list,
    ...img,
  }
}

export const getListFromId = (listId: string, t: Tx = db) =>
  t(tableNames.list).select('*').where('listId', listId).first<List>()

export const fetchImageAndStoreForNetwork = async (
  {
    chainId,
    uri,
    originalUri,
    providerKey,
  }: {
    chainId: number
    uri: string | Buffer
    originalUri: string
    providerKey: string
  },
  t: Tx = db,
) => {
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
  }
  const image = await fetchImage(uri, providerKey)
  if (!image) {
    utils.failureLog('no img %o -> %o', providerKey, originalUri)
    await writeMissing({
      providerKey,
      originalUri,
      listId: `${chainId}`,
    })
    return
  }
  return t.transaction(async (tx) => {
    await insertNetworkFromChainId(chainId, undefined, tx)
    const img = await insertImage(
      {
        originalUri,
        image,
        providerKey,
        listId: `${chainId}`,
      },
      tx,
    )
    if (!img) {
      return
    }
    const [network] = await tx
      .from(tableNames.network)
      .update('imageHash', img.image.imageHash)
      .where('chainId', chainId)
      .returning<Network[]>('*')
    return {
      network,
      ...img,
    }
  })
}

export const fetchImageAndStoreForToken = async (
  inputs: {
    listId: string | null
    uri: string | Buffer | null
    token: InsertableToken
    originalUri: string | null
    providerKey: string
  },
  t: Tx = db,
) => {
  const { listId, uri, token, providerKey } = inputs
  let { originalUri } = inputs
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
  }
  let providedId = token.providedId
  if (viem.isAddress(providedId)) {
    providedId = viem.getAddress(token.providedId)
  }
  if (_.isString(uri)) {
    const existing = await getImageFromLink(uri, t)
    if (existing) {
      const insertedToken = (await insertToken(
        {
          type: 'erc20',
          ...token,
          providedId,
        },
        t,
      )) as Token
      if (!listId) {
        return {
          ...existing,
          token: insertedToken,
        }
      }
      const listToken = await t(tableNames.listToken)
        .select<ListToken>(`${tableNames.listToken}.*`)
        .join(tableNames.token, {
          [`${tableNames.token}.tokenId`]: `${tableNames.listToken}.tokenId`,
        })
        .where({
          [`${tableNames.token}.networkId`]: token.networkId,
          [`${tableNames.token}.providedId`]: token.providedId,
        })
        .where({
          listId,
          imageHash: existing.image.imageHash,
        })
        .first<ListToken>()
      if (listToken) {
        return {
          ...existing,
          listToken,
          token: insertedToken,
        }
      }
    }
  }
  // list must have already been inserted to db by this point
  let img!: Awaited<ReturnType<typeof insertImage>>
  if (uri && originalUri) {
    const image = await fetchImage(uri, providerKey)
    if (!image) {
      await writeMissing({
        providerKey,
        originalUri,
        listId,
      })
      // return null
    } else {
      img = await insertImage(
        {
          providerKey,
          originalUri,
          image,
          listId,
        },
        t,
      )
    }
  }
  const insertedToken = await insertToken(
    {
      type: 'erc20',
      ...token,
      providedId,
    },
    t,
  )
  if (!listId) {
    return {
      token: insertedToken,
      ...img,
    }
  }
  const listToken = await insertListToken(
    {
      tokenId: insertedToken.tokenId,
      listId,
      imageHash: img?.image.imageHash,
    },
    t,
  )
  return {
    token: insertedToken,
    listToken,
    ...(img || {}),
  }
}

export const insertListToken = async (listToken: InsertableListToken | InsertableListToken[], t: Tx = db) => {
  return await t
    .from(tableNames.listToken)
    .insert(listToken)
    .onConflict(['listTokenId'])
    .merge(['listTokenId'])
    .returning<ListToken[]>('*')
}

export const insertList = async (list: InsertableList, t: Tx = db) => {
  return await t
    .from<List>(tableNames.list)
    .insert({
      patch: 0,
      minor: 0,
      major: 0,
      ...list,
    })
    .onConflict(['listId'])
    .merge(['listId', 'providerId', 'key', 'major', 'minor', 'patch', 'default'])
    .returning('*')
}

export const updateList = (list: Partial<List>, t: Tx = db) => {
  return t.from(tableNames.list).update(list).returning('*')
}

export const insertProvider = async (provider: InsertableProvider | InsertableProvider[], t: Tx = db) => {
  return await t
    .from(tableNames.provider)
    .insert(provider)
    .onConflict(['providerId'])
    .merge(['providerId'])
    .returning<Provider[]>('*')
}

export const insertOrder = async (
  order: InsertableListOrder,
  orderItems: BackfillableInsertableListOrderItem[],
  t: Tx = db,
) => {
  return t.transaction(async (tx) => {
    const [o] = await tx(tableNames.listOrder)
      .insert([order])
      .onConflict(['listOrderId'])
      .merge(['listOrderId'])
      .returning<ListOrder[]>('*')
    const insertableItems = orderItems.map((i) => ({
      ...i,
      listOrderId: o.listOrderId,
    }))
    // console.log(o, insertableItems)
    const items = await tx(tableNames.listOrderItem)
      .insert(insertableItems)
      .onConflict(['listOrderId', 'ranking'])
      .merge(['listOrderId', 'ranking'])
      .returning<ListOrderItem[]>('*')
    return {
      order: o,
      listOrderItems: items,
    }
  })
}

export const getTokensUnderListId = (t: Tx = db) => {
  return t
    .select([
      t.raw(`${tableNames.network}.chain_id`),
      t.raw(`${tableNames.token}.provided_id`),
      t.raw(`${tableNames.token}.decimals`),
      t.raw(`${tableNames.token}.symbol`),
      t.raw(`${tableNames.token}.name`),
      t.raw(`${tableNames.token}.token_id`),
      t.raw(`${tableNames.image}.image_hash`),
      t.raw(`${tableNames.image}.ext`),
    ])
    .from<types.TokenInfo>(tableNames.listToken)
    .fullOuterJoin(tableNames.image, {
      [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash`,
    })
    .join(tableNames.token, {
      [`${tableNames.token}.tokenId`]: `${tableNames.listToken}.tokenId`,
    })
    .join(tableNames.network, {
      [`${tableNames.network}.networkId`]: `${tableNames.token}.networkId`,
    })
}

export const getLists = (providerKey: string, listKey: string, t: Tx = db) => {
  return (
    t
      .from(tableNames.provider)
      .select<(Provider & List & ListToken & Image)[]>(['*', 'image.ext'])
      .join(...join(tableNames.list, tableNames.provider, [['providerId']]))
      .join(...join(tableNames.listToken, tableNames.list, [['listId']]))
      // .join(...join(tableNames.token, tableNames.listToken, [['tokenId']]))
      .fullOuterJoin(...join(tableNames.image, tableNames.list, [['imageHash']]))
      .where(
        listKey
          ? {
              [`${tableNames.provider}.key`]: providerKey,
              [`${tableNames.list}.key`]: listKey,
            }
          : {
              [`${tableNames.provider}.key`]: providerKey,
              [`${tableNames.list}.default`]: true,
            },
      )
      .orderBy('major', 'desc')
      .orderBy('minor', 'desc')
      .orderBy('patch', 'desc')
  )
}

export const addBridgeExtensions = (q: Knex.QueryBuilder) => {
  return q
    .select([
      db.raw(`row_to_json(${tableNames.bridge}.*) as bridge`),
      db.raw(`row_to_json(${tableNames.bridgeLink}.*) as bridge_link`),
      db.raw(`row_to_json(network_a.*) as network_a`),
      db.raw(`row_to_json(network_b.*) as network_b`),
      db.raw(`row_to_json(native_token.*) as native_token`),
      db.raw(`row_to_json(bridged_token.*) as bridged_token`),
    ])
    .fullOuterJoin(tableNames.bridgeLink, function joinBridgeInfo() {
      this.on(`${tableNames.bridgeLink}.nativeTokenId`, '=', `${tableNames.token}.tokenId`).orOn(
        `${tableNames.bridgeLink}.bridgedTokenId`,
        '=',
        `${tableNames.token}.tokenId`,
      )
    })
    .join(...join(tableNames.bridge, tableNames.bridgeLink, [['bridgeId']]))
    .join(...join(tableNames.network, tableNames.bridge, [['networkId', 'homeNetworkId']], 'network_a'))
    .join(...join(tableNames.network, tableNames.bridge, [['networkId', 'foreignNetworkId']], 'network_b'))
    .join(...join(tableNames.token, tableNames.bridgeLink, [['tokenId', 'nativeTokenId']], 'native_token'))
    .join(...join(tableNames.token, tableNames.bridgeLink, [['tokenId', 'bridgedTokenId']], 'bridged_token'))
  // .join(...join(tableNames.bridge, tableNames.bridgeLink, [['bridgeId']]))
}

export const getListOrderId = async (orderParam: string) => {
  let listOrderId: viem.Hex | null = null
  if (orderParam) {
    if (viem.isHex(orderParam)) {
      // presume that this is the list order id
      orderParam = orderParam as viem.Hex
    } else if (viem.isHex(`0x${orderParam}`)) {
      orderParam = `0x${orderParam}` as viem.Hex
      // presume that it is the list order key
    }
    if (orderParam && viem.toHex(viem.toBytes(orderParam), { size: 32 }).slice(2) !== orderParam) {
      // assume only a fragment is being given
      const listOrder = await getDB()
        .select<ListOrder>('*')
        .from(tableNames.listOrder)
        .whereILike('listOrderId', `%${orderParam.slice(2)}%`)
        .first()
      if (listOrder) {
        listOrderId = listOrder.listOrderId as viem.Hex
      }
    } else {
      listOrderId = orderParam as viem.Hex
    }
  }
  return listOrderId
}

export const applyOrder = (q: Knex.QueryBuilder, listOrderId: viem.Hex, t: Tx = getDB()) => {
  const qSub = q
    .join(tableNames.list, {
      [`${tableNames.list}.listId`]: `${tableNames.listToken}.listId`,
    })
    .fullOuterJoin(tableNames.listOrderItem, {
      [`${tableNames.listOrderItem}.listKey`]: `${tableNames.list}.key`,
      [`${tableNames.listOrderItem}.providerId`]: `${tableNames.list}.providerId`,
    })
    .join(tableNames.listOrder, {
      [`${tableNames.listOrder}.listOrderId`]: `${tableNames.listOrderItem}.listOrderId`,
    })
    .where(`${tableNames.listOrderItem}.listOrderId`, listOrderId)
    .denseRank('rank', function denseRankByConfiged() {
      return this.orderBy(`${tableNames.listOrderItem}.ranking`, 'asc')
        .orderBy(`${tableNames.list}.major`, 'desc')
        .orderBy(`${tableNames.list}.minor`, 'desc')
        .orderBy(`${tableNames.list}.patch`, 'desc')
        .partitionBy([
          `${tableNames.token}.token_id`,
          `${tableNames.token}.network_id`,
          `${tableNames.listOrderItem}.ranking`,
        ])
    })
  // console.log(qSub.toSQL().toNative())
  return t('ls').with('ls', qSub).select('ls.*').where('ls.rank', 1)
}

export const insertBridge = async (bridge: InsertableBridge, t: Tx = getDB()) => {
  const [b] = await t
    .insert(bridge)
    .into(tableNames.bridge)
    .onConflict(['bridgeId'])
    .merge(['bridgeId'])
    .returning<Bridge[]>('*')
  return b
}

export const insertBridgeLink = async (bridgeLink: InsertableBridgeLink, t: Tx = getDB()) => {
  const [bl] = await t
    .insert(bridgeLink)
    .into(tableNames.bridgeLink)
    .onConflict(['bridgeLinkId'])
    .merge(['bridgeLinkId'])
    .returning<BridgeLink[]>('*')
  return bl
}

export const updateBridgeBlockProgress = (bridgeId: string, updates: Partial<Bridge>, tx: Tx = getDB()) =>
  tx(tableNames.bridge).update(updates).where('bridgeId', bridgeId)
