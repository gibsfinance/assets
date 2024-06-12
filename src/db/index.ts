import knex, { type Knex } from 'knex'
import * as fs from 'fs'
import * as path from 'path'
import * as types from '../types'
import * as viem from 'viem'
import { config } from './config'
import * as fileType from 'file-type'
import * as utils from '../utils'
import { Tx, tableNames } from './tables'
import type { Image, InsertableList, InsertableListToken, InsertableProvider, InsertableToken, Link, List, ListToken, Network, Provider, ListOrder, ListOrderItem, InsertableListOrder, InsertableListOrderItem, BackfillableInsertableListOrderItem, Token } from 'knex/types/tables'
import { fetch } from '@/fetch'
import _ from 'lodash'
import promiseLimit from 'promise-limit'

export const ids = {
  provider: (key: string) => viem.keccak256(viem.toBytes(key)).slice(2)
}

let db = knex(config)

export const getDB = () => db

export const setDB = (k: Knex) => {
  db = k
}

type Transact<T> = typeof db.transaction<T>

export const transaction = async <T>(...a: Parameters<Transact<T>>) => (
  db.transaction(...a)
)

const getExt = async (image: Buffer, providedExt: string) => {
  const e = await fileType.fileTypeFromBuffer(image)
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
  imageHash, originalUri, providerKey, listId,
}: {
  imageHash?: string;
  originalUri: string;
  providerKey: string;
  listId: string;
}) => {
  const hash = imageHash || viem.keccak256(viem.toBytes(originalUri)).slice(2)
  return path.join(utils.root, 'missing', providerKey, listId, hash)
}

const limit1 = promiseLimit(1)

const removeMissing = async ({
  imageHash, originalUri, providerKey, listId,
}: {
  imageHash: string;
  originalUri: string;
  providerKey: string;
  listId: string;
}) => {
  const rf = {
    recursive: true,
    force: true,
  }
  await limit1(async () => (
    await Promise.all([
      fs.promises.rm(missingInfoPath({ imageHash, originalUri, providerKey, listId, }), rf),
      fs.promises.rm(missingInfoPath({ originalUri, providerKey, listId, }), rf),
    ])
  ))
}

const writeMissing = async ({
  providerKey,
  originalUri,
  imageHash,
  image,
  listId,
}: {
  providerKey: string;
  originalUri: string;
  listId: string;
  imageHash?: string;
  image?: Buffer
}) => {
  if (process.env.PREVENT_WRITE_MISSING) return
  const folder = missingInfoPath({ imageHash, originalUri, providerKey, listId })
  await limit1(async () => {
    await fs.promises.mkdir(folder, {
      recursive: true,
    })
    utils.failureLog('ext missing %o', folder)
    await Promise.all([
      fs.promises.writeFile(path.join(folder, 'info.json'), JSON.stringify({
        imageHash,
        originalUri,
        providerKey,
        listId,
      })),
      image && fs.promises.writeFile(path.join(folder, 'icon'), image),
    ])
  })
}

export const insertImage = async ({
  providerKey, originalUri, image, listId
}: {
  providerKey: string, originalUri: string, listId: string, image: Buffer
}, t: Tx = db) => {
  const imageHash = viem.keccak256(image).slice(2)
  const ext = await getExt(image, path.extname(originalUri))
  if (!ext) {
    console.log('no ext %o -> %o', providerKey, originalUri)
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
    t.from(tableNames.image).insert({
      content: image,
      ext,
    }).onConflict(['imageHash'])
      .merge(['imageHash'])
      .returning<Image[]>(['ext', 'imageHash']),
  ])
  const [link] = await t.from(tableNames.link).insert([{
    uri: originalUri,
    imageHash: inserted.imageHash,
  }]).onConflict(['uri']).merge(['uri']).returning<Link[]>('*')
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
    return fs.promises.readFile(url).catch((err) => {
      console.log('read file failed %o -> %o', providerKey, url)
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
        console.log('fetch failure %o -> %o', providerKey, url)
        const errStr = err.toString()
        if (errStr.includes('This operation was abort')) {
          return null
        }
        if (errStr.includes('Invalid URL')) {
          return null
        }
        console.log(err)
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
  const [network] = await t.from(tableNames.network).insert({
    type,
    chainId: chainId.toString(),
  })
    .onConflict(['networkId'])
    .merge(['networkId'])
    .returning<Network[]>('*')
  return network
}

export const insertToken = async (token: InsertableToken, t: Tx = db) => {
  const [inserted] = await t.from(tableNames.token)
    .insert({
      ...token,
      name: token.name.split('\x00').join(''),
      symbol: token.symbol.split('\x00').join(''),
    })
    .onConflict(['networkId', 'providedId'])
    .merge(['networkId', 'providedId'])
    .returning<Token[]>('*')
  return inserted
}

export const getImageFromLink = async (uri: string, t: Tx = db) => {
  const link = await t.from(tableNames.link)
    .select('*')
    .where('uri', uri)
    .first<Link>()
  if (!link) return null
  const image = await t.from(tableNames.image)
    .select('*')
    .where('imageHash', link.imageHash)
    .first<Image>()
  if (!image) return null
  return {
    link,
    image,
  }
}

export const fetchImageAndStoreForList = async ({
  listId, uri,
  originalUri,
  providerKey,
}: {
  listId: string;
  uri: string | Buffer;
  originalUri: string;
  providerKey: string;
}, t: Tx = db,
) => {
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
  }
  if (_.isString(uri)) {
    const existing = await getImageFromLink(uri)
    if (existing) {
      const list = await t(tableNames.list)
        .select<List>('*')
        .where('listId', listId)
        .first() as List
      if (list && list.imageHash && list.imageHash === existing.image.imageHash) {
        return {
          ...existing,
          list,
        }
      }
    }
  }
  const image = await fetchImage(uri, providerKey)
  if (!image) {
    console.log('no img %o -> %o', providerKey, originalUri)
    await writeMissing({
      providerKey,
      originalUri,
      listId,
    })
    return
  }
  const img = await insertImage({
    originalUri,
    image,
    providerKey,
    listId,
  }, t)
  if (!img) {
    return
  }
  const [list] = await t.from(tableNames.list)
    .update('imageHash', img.image.imageHash)
    .where('listId', listId)
    .returning<List[]>('*')
  return {
    list,
    ...img,
  }
}

export const fetchImageAndStoreForToken = async (inputs: {
  listId: string;
  uri: string | Buffer;
  token: InsertableToken;
  originalUri: string;
  providerKey: string;
}, t: Tx = db) => {
  let {
    listId,
    uri,
    token,
    originalUri,
    providerKey,
  } = inputs
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
  }
  const providedId = viem.isAddress(token.providedId) ? viem.getAddress(token.providedId) : token.providedId
  if (_.isString(uri)) {
    const existing = await getImageFromLink(uri)
    if (existing) {
      const listToken = await t(tableNames.listToken)
        .select<ListToken>('*')
        .where({
          networkId: token.networkId,
          providedId,
          listId,
          imageHash: existing.image.imageHash,
        })
        .first() as ListToken
      if (listToken) {
        return {
          ...existing,
          listToken,
          token,
        }
      }
    }
  }
  // list must have already been inserted to db by this point
  const image = await fetchImage(uri, providerKey)
  if (!image) {
    await writeMissing({
      providerKey,
      originalUri,
      listId,
    })
    return null
  }
  const img = await insertImage({
    providerKey,
    originalUri,
    image,
    listId,
  }, t)
  if (!img) {
    return null
  }
  const insertedToken = await insertToken({
    type: 'erc20',
    ...token,
    providedId: viem.isAddress(token.providedId) ? viem.getAddress(token.providedId) : token.providedId,
  })
  const listToken = await insertListToken({
    networkId: token.networkId,
    providedId,
    listId,
    imageHash: img.image.imageHash,
  })
  return {
    token: insertedToken,
    listToken,
    ...img,
  }
}

export const insertListToken = async (listToken: InsertableListToken, t: Tx = db) => {
  const [inserted] = await t.from(tableNames.listToken)
    .insert([listToken])
    .onConflict(['listTokenId'])
    .merge(['listTokenId'])
    .returning<InsertableListToken[]>('*')
  return inserted
}

export const insertList = async (list: InsertableList, t: Tx = db) => {
  const [insertedList] = await t.from<List>(tableNames.list)
    .insert({
      patch: 0,
      minor: 0,
      major: 0,
      ...list,
    })
    .onConflict(['listId'])
    .merge(['listId', 'providerId', 'key', 'major', 'minor', 'patch'])
    .returning('*')
  return insertedList
}

export const insertProvider = async (provider: InsertableProvider, t: Tx = db) => {
  const [inserted] = await t.from(tableNames.provider)
    .insert<Provider[]>([provider])
    .onConflict(['providerId'])
    .merge(['providerId'])
    .returning('*')
  return inserted
}

export const insertOrder = async (order: InsertableListOrder, orderItems: BackfillableInsertableListOrderItem[], t: Tx = db) => {
  return t.transaction(async (tx) => {
    const [o] = await tx(tableNames.listOrder)
      .insert([order])
      .onConflict(['listOrderId'])
      .merge(['listOrderId'])
      .returning<ListOrder[]>('*')
    const items = await tx(tableNames.listOrderItem)
      .insert(orderItems.map((i) => ({
        ...i,
        listOrderId: o.listOrderId,
      })))
      .onConflict(['listOrderId', 'ranking'])
      .merge(['listOrderId', 'ranking'])
      .returning<ListOrderItem[]>('*')
    return {
      order: o,
      listOrderItems: items,
    }
  })
}

export const getTokensUnderListId = async (listId: string, t: Tx = db) => {
  return t.select([
    db.raw(`${tableNames.network}.chain_id`),
    db.raw(`${tableNames.token}.provided_id as address`),
    db.raw(`${tableNames.token}.decimals as decimals`),
    db.raw(`${tableNames.token}.symbol as symbol`),
    db.raw(`${tableNames.token}.name as name`),
    db.raw(`${tableNames.image}.image_hash as image_hash`),
    db.raw(`${tableNames.image}.ext as ext`),
  ])
    .from(tableNames.listToken)
    .where(`${tableNames.listToken}.listId`, listId)
    .join(tableNames.image, {
      [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash`,
    })
    .join(tableNames.token, {
      [`${tableNames.token}.networkId`]: `${tableNames.listToken}.networkId`,
      [`${tableNames.token}.providedId`]: `${tableNames.listToken}.providedId`,
    })
    .join(tableNames.network, {
      [`${tableNames.network}.networkId`]: `${tableNames.listToken}.networkId`,
    })
}

export const getList = (providerKey: string, listKey = 'default', t: Tx = db) => (
  t.from(tableNames.provider)
    .select<(Provider & List & ListToken & Image)[]>([
      '*',
      'image.ext',
    ])
    .join(tableNames.list, {
      [`${tableNames.list}.providerId`]: `${tableNames.provider}.providerId`,
    })
    .join(tableNames.listToken, {
      [`${tableNames.list}.listId`]: `${tableNames.listToken}.listId`,
    })
    .fullOuterJoin(tableNames.image, {
      [`${tableNames.image}.imageHash`]: `${tableNames.list}.imageHash`,
    })
    .where({
      [`${tableNames.provider}.key`]: providerKey,
      [`${tableNames.list}.key`]: listKey,
    })
    .orderBy('major', 'desc')
    .orderBy('minor', 'desc')
    .orderBy('patch', 'desc')
    .first()
)
