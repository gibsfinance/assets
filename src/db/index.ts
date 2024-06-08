import knex, { type Knex } from 'knex'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as types from '../types'
import * as viem from 'viem'
import { config } from './config'
import * as fileType from 'file-type'
import * as utils from '../utils'
import { Tx, tableNames } from './tables'
import { Image, InsertableList, InsertableListToken, InsertableProvider, InsertableToken, List, Network, Provider, Token } from 'knex/types/tables'
import { setTimeout } from 'timers/promises'
import { fetch } from '@/fetch'
import _ from 'lodash'

let db = knex(config)

export const getDB = () => db

export const setDB = (k: Knex) => {
  db = k
}

type Transact<T> = typeof db.transaction<T>

export const transaction = async <T>(...a: Parameters<Transact<T>>) => (
  db.transaction(...a)
)

const getExt = async (image: Buffer) => {
  const e = await fileType.fileTypeFromBuffer(image)
  const ext = e && e.ext ? `.${e.ext}` : null
  if (ext) return ext
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
  await Promise.all([
    fs.promises.rm(missingInfoPath({ imageHash, originalUri, providerKey, listId, }), rf),
    fs.promises.rm(missingInfoPath({ originalUri, providerKey, listId, }), rf),
  ])
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
  const folder = missingInfoPath({ imageHash, originalUri, providerKey, listId })
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
}

export const insertImage = async ({
  providerKey, originalUri, image, listId
}: {
  providerKey: string, originalUri: string, listId: string, image: Buffer
}, t: Tx = db) => {
  const imageHash = viem.keccak256(image).slice(2)
  const ext = await getExt(image)
  if (!ext) {
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
    t.from(tableNames.image).insert<Image[]>({
      content: image,
      ext,
    }).onConflict(['imageHash'])
      .merge(['imageHash'])
      .returning(['ext', 'imageHash']),
  ])
  return inserted
}

export const fetchImage = async (url: string | Buffer, providerKey: string | null = null) => {
  if (Buffer.isBuffer(url)) {
    return url
  }
  if (!url) {
    return null
  }
  if (url.startsWith(os.homedir())) {
    return fs.promises.readFile(url)
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
        if (err.toString().includes('This operation was abort')) {
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
    networkId: utils.toKeccakBytes(`${type}${chainId}`),
  })
    .onConflict(['networkId'])
    .merge(['networkId'])
    .returning<Network[]>('*')
  return network
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
  const image = await fetchImage(uri, providerKey)
  if (!image) {
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
  const list = await t.from(tableNames.list)
    .update('imageHash', img.imageHash)
    .where('listId', listId)
  return {
    list,
    img,
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
  if (token.networkId === utils.chainIdToNetworkId(1) && token.providedId === viem.zeroAddress) {
    console.log(inputs)
  }
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
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
  const providedId = viem.isAddress(token.providedId) ? viem.getAddress(token.providedId) : token.providedId
  const [insertedToken] = await t.from(tableNames.token)
    .insert<InsertableToken[]>([{
      type: 'erc20',
      ...token,
      providedId: viem.isAddress(token.providedId) ? viem.getAddress(token.providedId) : token.providedId,
    }])
    .onConflict(['networkId', 'providedId'])
    .merge(['networkId', 'providedId'])
    .returning('*')
  const [listToken] = await t.from(tableNames.listToken)
    .insert<InsertableListToken[]>([{
      networkId: token.networkId,
      providedId,
      listId,
      imageHash: img.imageHash,
    }])
    .onConflict(['listTokenId'])
    .merge(['listTokenId'])
    .returning('*')
  return {
    token: insertedToken,
    listToken,
    img,
  }
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
    .merge(['listId'])
    .returning('*')
  return insertedList
}

export const insertProvider = async (provider: InsertableProvider, t: Tx = db) => {
  const [inserted] = await t.from(tableNames.provider)
    .insert<Provider[]>([{
      ...provider,
      providerId: viem.keccak256(viem.toBytes(provider.key)).slice(2),
    }])
    .onConflict(['providerId'])
    .merge(['providerId'])
    .returning('*')
  return inserted
}
