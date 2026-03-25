import knex, { type Knex } from 'knex'
import * as fs from 'fs'
import * as path from 'path'
import * as viem from 'viem'
import { failureLog, responseToBuffer, timeout, type Timeout, type ChainId } from '@gibs/utils'
import * as paths from '../paths'
import * as types from '../types'
import { config } from './config'
import * as fileType from 'file-type'
import { sanitizeImage } from '../sanitize'
import * as utils from '../utils'
import { Tx, imageMode, tableNames } from './tables'
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
  InsertableHeaderLink,
  HeaderLink,
  CacheRequest,
  InsertableCacheRequest,
  ImageVariant,
  InsertableImageVariant,
} from 'knex/types/tables'
import { fetch } from '../fetch'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import { join } from './utils'
import * as args from '../args'
import { getDrizzle, type DrizzleTx } from './drizzle'
import { eq, and, lt, gte, sql as dsql } from 'drizzle-orm'
import * as s from './schema'

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
  imageHash: (image: Buffer, uri: string, ext: string | null) =>
    viem
      .keccak256(
        viem.concatBytes([
          Uint8Array.from(image), //
          viem.toBytes(uri),
          viem.toBytes(ext || ''),
        ]),
      )
      .slice(2),
}

let db = knex(config)

// setInterval(() => {
//   db.raw('SELECT * FROM pg_stat_activity').then((res) => {
//     const grouped = _(res.rows)
//       .map(({ query }) => query)
//       .reduce((accum, row) => {
//         if (!row) return accum
//         const id = viem.keccak256(viem.stringToBytes(row))
//         let existing = accum.get(id)
//         if (existing) accum.set(id, [existing[0] + 1, row])
//         else accum.set(id, [1, row])
//         return accum
//       }, new Map<string, [number, string]>())
//     console.log(grouped)
//   })
// }, 5000)

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
  return path.join(paths.root, 'missing', providerKey, `${listId}`, hash)
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
    failureLog('ext missing %o %o', originalUri, folder)
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
  const ext = await getExt(image, path.extname(originalUri))
  const imageHash = ids.imageHash(image, originalUri, ext)
  if (!ext) {
    failureLog('no ext %o -> %o', providerKey, originalUri)
    await writeMissing({
      providerKey,
      originalUri,
      imageHash,
      image,
      listId,
    })
    return null
  }
  // Sanitize: re-encode rasters (strips EXIF/payloads), strip SVG scripts
  const sanitized = await sanitizeImage(image, ext)
  const shouldSave = args.checkShouldSave(providerKey)
  const insertable = {
    uri: originalUri,
    content: shouldSave ? sanitized : Buffer.from([]),
    imageHash,
    ext,
    mode: shouldSave ? imageMode.SAVE : imageMode.LINK,
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
      .insert(insertable)
      .onConflict(['imageHash'])
      .merge(['content', 'mode', 'uri']) // Don't update uri, ext, or imageHash
      .returning<Image[]>(['ext', 'imageHash', 'uri', 'content']),
  ])
  // this fails for some reason when the db creates the image hash
  // figure out why
  // if (imageHash !== inserted.imageHash) {
  //   log(insertable, inserted, imageHash)
  //   throw new Error('image hash mismatch')
  // } else {
  //   log('image hash match %o', imageHash)
  // }
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

export const fetchImage = async (
  url: string | Buffer,
  signal: AbortSignal | null | undefined,
  providerKey: string | null = null,
  address?: string,
) => {
  if (Buffer.isBuffer(url)) {
    return url
  }
  if (!url) {
    return null
  }
  if (url.startsWith('/')) {
    return fs.promises.readFile(url).catch(() => {
      failureLog('read file failed %o -> %o', providerKey, address, url, address)
      return null
    })
  }
  const timeoutSignal = AbortSignal.timeout(3_000)
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  return await fetch(url, { signal: combinedSignal })
    .then(responseToBuffer)
    .catch((err: Error) => {
      const errStr = err.toString()
      if (errStr.includes('abort') || errStr.includes('TimeoutError')) {
        return null
      }
      if (errStr.includes('Invalid URL')) {
        return null
      }
      failureLog('fetch failure %o -> %o', providerKey, address, url)
      return null
    })
}

/**
 * Network Insertion with Retry Logic
 * @param chainId The chain ID to insert
 * @param type The network type (default: 'evm')
 * @param t The transaction object
 */
export const insertNetworkFromChainId = async (chainId: ChainId, type = 'evm', tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  // networkId is generated by a DB trigger from (type, chainId) — provide placeholder for Drizzle's type system
  const [network] = await db
    .insert(s.network)
    .values({
      networkId: dsql`''`,
      type,
      chainId: chainId.toString(),
    })
    .onConflictDoUpdate({
      target: s.network.networkId,
      set: { networkId: dsql`excluded.network_id` },
    })
    .returning()
  return network
}

export const getNetworks = (tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  return db.select().from(s.network)
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

/**
 * Check whether a cached image link is still fresh based on link.updated_at.
 * Returns the existing {link, image} if fresh, null if stale or missing.
 */
export const getFreshImageFromLink = async (uri: string, maxAgeMs: number, t: Tx = db) => {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const link = await t
    .from(tableNames.link)
    .select('*')
    .where('uri', uri)
    .where('updated_at', '>=', cutoff)
    .first<Link>()
  if (!link) return null
  const image = await t.from(tableNames.image).select('*').where('imageHash', link.imageHash).first<Image>()
  if (!image) return null
  return { link, image }
}

/**
 * Fetch an image from a URL and detect its file extension.
 * Pure fetch — no database writes. Returns null on failure.
 */
export const resolveImage = async (
  uri: string | Buffer,
  signal: AbortSignal | null | undefined,
  providerKey: string,
  address?: string,
): Promise<{ buffer: Buffer; ext: string; originalUri: string } | null> => {
  const image = await fetchImage(uri, signal, providerKey, address)
  if (!image) return null
  const originalUri = Buffer.isBuffer(uri) ? `buffer:${providerKey}:${address}` : uri
  const ext = await getExt(image, path.extname(originalUri))
  if (!ext) return null
  return { buffer: image, ext, originalUri }
}

/**
 * Batch insert tokens. Returns all upserted token records.
 */
export const insertTokenBatch = async (tokens: InsertableToken[], t: Tx = db) => {
  if (!tokens.length) return []
  const cleaned = tokens.map((token) => {
    let providedId = token.providedId
    if (viem.isAddress(providedId)) {
      providedId = viem.getAddress(providedId)
    }
    return {
      type: 'erc20' as const,
      ...token,
      providedId,
      name: token.name.split('\x00').join(''),
      symbol: token.symbol.split('\x00').join(''),
    }
  })
  // PG has a ~65535 parameter limit; 7 columns per row → max ~500 rows per batch
  const chunkSize = 500
  const results: Token[] = []
  for (let i = 0; i < cleaned.length; i += chunkSize) {
    const chunk = cleaned.slice(i, i + chunkSize)
    const rows = await t
      .from(tableNames.token)
      .insert(chunk)
      .onConflict(['tokenId'])
      .merge(['tokenId'])
      .returning<Token[]>('*')
    results.push(...rows)
  }
  return results
}

/**
 * Insert a token and its list association without any image logic.
 * Use when images are handled separately or not needed (e.g. routescan).
 */
export const storeToken = async (
  {
    token,
    listId,
    imageHash,
    listTokenOrderId,
  }: {
    token: InsertableToken
    listId: string
    imageHash?: string
    listTokenOrderId: number
  },
  t: Tx = db,
) => {
  const insertedToken = await insertToken({ type: 'erc20', ...token }, t)
  const [listToken] = await insertListToken(
    {
      tokenId: insertedToken.tokenId,
      listId,
      imageHash,
      listTokenOrderId,
    },
    t,
  )
  return { token: insertedToken, listToken }
}

/**
 * Batch fetch and store images for multiple list tokens.
 * Used to separate image fetching from token insertion for better performance.
 */
export const batchFetchImagesForTokens = async (
  tokenImages: {
    listTokenId: string
    uri: string | null
    originalUri: string | null
    providerKey: string
    signal?: AbortSignal
  }[],
  t: Tx = db,
) => {
  if (!tokenImages.length) return []

  // Use promiseLimit to control concurrency
  const limit = promiseLimit(8) // Limit to 8 concurrent image fetches

  const results = await Promise.allSettled(
    tokenImages.map((item) =>
      limit(async () => {
        if (!item.uri) return null

        try {
          const resolved = await resolveImage(item.uri, item.signal, item.providerKey)
          if (!resolved) return null

          const imageHash = ids.imageHash(resolved.buffer, resolved.originalUri, resolved.ext)

          // Store the image
          const imageResult = await insertImage(
            {
              providerKey: item.providerKey,
              originalUri: resolved.originalUri,
              image: resolved.buffer,
              listId: null, // We'll update the listToken separately
            },
            t,
          )

          if (!imageResult) {
            return { listTokenId: item.listTokenId, success: false, error: 'Failed to insert image' }
          }

          const { image } = imageResult

          // Update the list token with the image hash
          await t(tableNames.listToken).where('listTokenId', item.listTokenId).update({ imageHash })

          return { listTokenId: item.listTokenId, success: true, image }
        } catch (error) {
          failureLog('Failed to fetch image for listToken %o: %o', item.listTokenId, error)
          return { listTokenId: item.listTokenId, success: false, error }
        }
      }),
    ),
  )

  return results.map((result, index) => ({
    ...tokenImages[index],
    result: result.status === 'fulfilled' ? result.value : { success: false, error: result.reason },
  }))
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
    signal,
    maxImageAge = sixHours,
  }: {
    listId: string
    uri: string | Buffer | null
    originalUri: string | null
    providerKey: string
    signal?: AbortSignal
    maxImageAge?: number
  },
  t: Tx = db,
) => {
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
  }
  if (_.isString(uri)) {
    const existing = await getFreshImageFromLink(uri, maxImageAge, t)
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
  const image = await fetchImage(uri, signal, providerKey, `list-id:${listId}`)
  if (!image) {
    failureLog('no img %o -> %o', providerKey, originalUri)
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

export const getListFromId = async (listId: string, tx?: DrizzleTx | Tx) => {
  // During Knex→Drizzle transition: ignore Knex Tx, use Drizzle directly. Callers still pass Knex Tx.
  const db = (tx && 'select' in tx && '$with' in tx ? tx : null) ?? getDrizzle()
  const [row] = await db.select().from(s.list).where(eq(s.list.listId, listId)).limit(1)
  return row
}

export const fetchImageAndStoreForNetwork = async (
  {
    network,
    uri,
    originalUri,
    providerKey,
    signal,
    maxImageAge = sixHours,
  }: {
    network: Network
    uri: string | Buffer
    originalUri: string
    providerKey: string
    signal?: AbortSignal
    maxImageAge?: number
  },
  t: Tx = db,
) => {
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
  }
  if (_.isString(uri)) {
    const existing = await getFreshImageFromLink(uri, maxImageAge, t)
    if (existing) return { network, ...existing }
  }
  const image = await fetchImage(uri, signal, providerKey, `chain-id:${network.chainId}`)
  if (!image) {
    failureLog('no img %o -> %o', providerKey, originalUri)
    await writeMissing({
      providerKey,
      originalUri,
      listId: `${network.chainId}`,
    })
    return
  }
  return t.transaction(async (tx) => {
    const img = await insertImage(
      {
        originalUri,
        image,
        providerKey,
        listId: `${network.chainId}`,
      },
      tx,
    )
    if (!img) {
      return
    }
    const [ntwrk] = await tx
      .from(tableNames.network)
      .update('imageHash', img.image.imageHash)
      .where('networkId', network.networkId)
      .returning<Network[]>('*')
    return {
      network: ntwrk,
      ...img,
    }
  })
}

export const fetchAndInsertHeader = async (
  header: {
    providerKey: string
    listTokenId: string
    uri: string | Buffer
    originalUri: string
    signal?: AbortSignal
    maxImageAge?: number
  },
  t: Tx = db,
) => {
  const maxImageAge = header.maxImageAge ?? sixHours
  if (_.isString(header.uri)) {
    const existing = await getFreshImageFromLink(header.uri, maxImageAge, t)
    if (existing) return
  }
  const image = await fetchImage(header.uri, header.signal, header.providerKey, header.listTokenId)
  if (!image) {
    return
  }
  await t.transaction(async (tx) => {
    const result = await insertImage(
      {
        providerKey: header.providerKey,
        originalUri: header.originalUri,
        image,
        listId: header.listTokenId,
      },
      t,
    )
    if (!result) {
      return
    }
    const { image: img } = result
    const [inserted] = await insertHeaderLink(
      {
        listTokenId: header.listTokenId,
        imageHash: img.imageHash,
      },
      tx,
    )
    return inserted
  })
}

export const insertHeaderLink = async (header: InsertableHeaderLink, t: Tx = db) => {
  return await t
    .from(tableNames.headerLink)
    .insert(header)
    .onConflict(['listTokenId'])
    .merge(['listTokenId'])
    .returning<HeaderLink[]>('*')
}

const sixHours = 1000 * 60 * 60 * 6

export const fetchImageAndStoreForToken = async (
  inputs: {
    listId: string
    listTokenOrderId: number
    uri: string | Buffer | null
    originalUri: string | null
    token: InsertableToken
    providerKey: string
    signal?: AbortSignal
    maxImageAge?: number
  },
  t: Tx = db,
): Promise<{
  token: Token
  listToken: ListToken
  link?: Link
  image?: Image
}> => {
  const { listId, uri, token, providerKey, signal, listTokenOrderId, maxImageAge = sixHours } = inputs
  if (!listId) {
    throw new Error('listId is required')
  }
  let { originalUri } = inputs
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
  }
  let providedId = token.providedId
  if (viem.isAddress(providedId)) {
    providedId = viem.getAddress(token.providedId)
  }
  const getListToken = async (tokenId: string, imageHash: string) =>
    await t(tableNames.listToken)
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
        imageHash,
        [`${tableNames.listToken}.tokenId`]: tokenId,
      })
      .first<ListToken>()
  if (_.isString(uri)) {
    const existing = await getFreshImageFromLink(uri, maxImageAge, t)
    if (existing) {
      const insertedToken = (await insertToken(
        {
          type: 'erc20',
          ...token,
          providedId,
        },
        t,
      )) as Token
      if (listId) {
        if (
          insertedToken.name === token.name &&
          insertedToken.symbol === token.symbol &&
          insertedToken.decimals === token.decimals
        ) {
          const listToken = await getListToken(insertedToken.tokenId, existing.image.imageHash)
          if (listToken && listToken.listTokenOrderId === listTokenOrderId) {
            return {
              ...existing,
              listToken,
              token: insertedToken,
            }
          }
        }
      }
    }
  }
  // list must have already been inserted to db by this point
  let img!: Awaited<ReturnType<typeof insertImage>>
  if (uri && originalUri) {
    const image = await fetchImage(uri, signal, providerKey, token.providedId)
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
  const [listToken] = await insertListToken(
    {
      tokenId: insertedToken.tokenId,
      listId,
      imageHash: img?.image.imageHash,
      listTokenOrderId,
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

export const insertList = async (list: InsertableList, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  // listId is generated by a DB trigger from (providerId, key, major, minor, patch) — provide placeholder
  return await db
    .insert(s.list)
    .values({
      listId: dsql`''`,
      patch: 0,
      minor: 0,
      major: 0,
      ...list,
    })
    .onConflictDoUpdate({
      target: s.list.listId,
      set: {
        listId: dsql`excluded.list_id`,
        providerId: dsql`excluded.provider_id`,
        key: dsql`excluded.key`,
        major: dsql`excluded.major`,
        minor: dsql`excluded.minor`,
        patch: dsql`excluded.patch`,
        default: dsql`excluded."default"`,
      },
    })
    .returning()
}

// TODO: This updates ALL rows in the list table — no WHERE clause. Likely a bug; preserve behavior for now.
export const updateList = (list: Partial<List>, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  return db.update(s.list).set(list as Record<string, unknown>).returning()
}

export const insertProvider = async (provider: InsertableProvider | InsertableProvider[], tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const items = Array.isArray(provider) ? provider : [provider]
  // providerId is generated by a DB trigger from (key) — provide placeholder
  const values = items.map((p) => ({ providerId: dsql`''`, ...p }))
  return await db
    .insert(s.provider)
    .values(values)
    .onConflictDoUpdate({
      target: s.provider.providerId,
      set: { providerId: dsql`excluded.provider_id` },
    })
    .returning()
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
      t.raw(`${tableNames.image}.mode`),
      t.raw(`${tableNames.image}.uri`),
      t.raw(`${tableNames.provider}.key as provider_key`),
      t.raw(`${tableNames.list}.key as list_key`),
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
    .join(tableNames.list, {
      [`${tableNames.list}.listId`]: `${tableNames.listToken}.listId`,
    })
    .join(tableNames.provider, {
      [`${tableNames.provider}.providerId`]: `${tableNames.list}.providerId`,
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

export const addHeaderUriExtension = (q: Knex.QueryBuilder) => {
  return q
    .fullOuterJoin(tableNames.headerLink, {
      [`${tableNames.headerLink}.listTokenId`]: `${tableNames.listToken}.listTokenId`,
    })
    .select([
      `${tableNames.headerLink}.list_token_id as header_list_token_id`,
      `${tableNames.headerLink}.image_hash as header_image_hash`,
    ])
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
  if (!orderParam) return null

  // Try lookup by key first (e.g. "default")
  const byKey = await getDB()
    .select<ListOrder>('*')
    .from(tableNames.listOrder)
    .where('key', orderParam)
    .first()
  if (byKey) return byKey.listOrderId as viem.Hex

  // Try as hex listOrderId
  let hex = orderParam
  if (viem.isHex(orderParam)) {
    hex = orderParam
  } else if (viem.isHex(`0x${orderParam}`)) {
    hex = `0x${orderParam}`
  }

  if (hex && viem.toHex(viem.toBytes(hex), { size: 32 }).slice(2) !== hex) {
    // Fragment search
    const listOrder = await getDB()
      .select<ListOrder>('*')
      .from(tableNames.listOrder)
      .whereILike('listOrderId', `%${hex.replace(/^0x/, '')}%`)
      .first()
    if (listOrder) return listOrder.listOrderId as viem.Hex
  } else {
    return hex as viem.Hex
  }

  return null
}

/**
 * Apply dense-rank ordering to select the top image per token.
 * SVGs are always preferred over raster images regardless of provider ranking.
 *
 * PRECONDITION: The query `q` must already join the `image` table
 * (all callers in image/handlers.ts do this via getListTokens).
 */
export const applyOrder = (q: Knex.QueryBuilder, listOrderId: viem.Hex, t: Tx = getDB()) => {
  const qSub = q
    .leftJoin(tableNames.listOrderItem, function () {
      this.on(`${tableNames.listOrderItem}.listKey`, `${tableNames.list}.key`)
        .andOn(`${tableNames.listOrderItem}.providerId`, `${tableNames.list}.providerId`)
        .andOnVal(`${tableNames.listOrderItem}.listOrderId`, listOrderId)
    })
    .denseRank('rank', function denseRankByConfiged() {
      return this.orderBy(
        t.raw(`CASE WHEN ${tableNames.image}.ext = '.svg' THEN 0 ELSE 1 END`) as unknown as string,
        'asc',
      )
        .orderBy(
          t.raw(`COALESCE(${tableNames.listOrderItem}.ranking, 9223372036854775807)`) as unknown as string,
          'asc',
        )
        .orderBy(`${tableNames.list}.major`, 'desc')
        .orderBy(`${tableNames.list}.minor`, 'desc')
        .orderBy(`${tableNames.list}.patch`, 'desc')
        .orderBy(`${tableNames.listToken}.listTokenOrderId`, 'asc')
        .partitionBy([`${tableNames.token}.token_id`, `${tableNames.token}.network_id`])
    })
  return t('ls').with('ls', qSub).select('ls.*').where('ls.rank', 1)
}

export const getVariant = async (
  imageHash: string,
  width: number,
  height: number,
  format: string,
  tx?: DrizzleTx,
) => {
  const db = tx ?? getDrizzle()
  const [row] = await db
    .select()
    .from(s.imageVariant)
    .where(
      and(
        eq(s.imageVariant.imageHash, imageHash),
        eq(s.imageVariant.width, width),
        eq(s.imageVariant.height, height),
        eq(s.imageVariant.format, format),
      ),
    )
    .limit(1)
  return row
}

export const insertVariant = async (
  variant: InsertableImageVariant,
  tx?: DrizzleTx,
): Promise<void> => {
  const db = tx ?? getDrizzle()
  await db
    .insert(s.imageVariant)
    .values(variant)
    .onConflictDoUpdate({
      target: [s.imageVariant.imageHash, s.imageVariant.width, s.imageVariant.height, s.imageVariant.format],
      set: { content: variant.content, lastAccessedAt: dsql`NOW()` },
    })
}

export const bumpVariantAccess = async (
  imageHash: string,
  width: number,
  height: number,
  format: string,
  tx?: DrizzleTx,
): Promise<void> => {
  const db = tx ?? getDrizzle()
  await db
    .update(s.imageVariant)
    .set({
      accessCount: dsql`${s.imageVariant.accessCount} + 1`,
      lastAccessedAt: dsql`NOW()`,
    })
    .where(
      and(
        eq(s.imageVariant.imageHash, imageHash),
        eq(s.imageVariant.width, width),
        eq(s.imageVariant.height, height),
        eq(s.imageVariant.format, format),
      ),
    )
}

export const pruneVariants = async (
  minAccessCount: number = 3,
  maxAgeHours: number = 24,
  tx?: DrizzleTx,
): Promise<number> => {
  const db = tx ?? getDrizzle()
  const deleted = await db
    .delete(s.imageVariant)
    .where(
      and(
        lt(s.imageVariant.accessCount, minAccessCount),
        lt(s.imageVariant.lastAccessedAt, dsql`NOW() - INTERVAL '${dsql.raw(String(maxAgeHours))} hours'`),
      ),
    )
    .returning()
  await db.update(s.imageVariant).set({ accessCount: 0 })
  return deleted.length
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

export const getBridge = (bridgeId: string, tx: Tx = getDB()) =>
  tx(tableNames.bridge).where('bridgeId', bridgeId).first<Bridge>()

export const getLatestBridgeToken = (bridgeId: string, tx: Tx = getDB()) =>
  tx(tableNames.bridgeLink)
    .join(tableNames.token, {
      [`${tableNames.token}.tokenId`]: `${tableNames.bridgeLink}.bridgedTokenId`,
    })
    .count('*')
    .where('bridgeId', bridgeId)
    .orderBy('bridgeLinkId', 'desc')
    .first()

export const getCachedRequest = async (key: string, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const [row] = await db
    .select()
    .from(s.cacheRequest)
    .where(and(eq(s.cacheRequest.key, key), gte(s.cacheRequest.expiresAt, dsql`NOW()`)))
    .limit(1)
  return row
}

export const purgeExpiredCache = (tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  return db.delete(s.cacheRequest).where(lt(s.cacheRequest.expiresAt, dsql`NOW()`))
}

export const insertCacheRequest = (cacheRequest: InsertableCacheRequest, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  // Knex InsertableCacheRequest has expiresAt: Date; Drizzle schema uses mode: 'string'.
  // The pg driver handles both at runtime — cast to satisfy Drizzle's type system during transition.
  const values = cacheRequest as unknown as typeof s.cacheRequest.$inferInsert
  return db
    .insert(s.cacheRequest)
    .values(values)
    .onConflictDoUpdate({
      target: s.cacheRequest.key,
      set: {
        value: dsql`excluded.value`,
        expiresAt: dsql`excluded.expires_at`,
      },
    })
    .returning()
}

const defaultTTL = 1000 * 60 * 60

export const cachedJSONRequest = async <T extends object>(
  key: string,
  signal: AbortSignal,
  ...args: Parameters<typeof fetch>
) => {
  return cachedJSON(key, signal, async (signal) => {
    return fetch(args[0], { signal, ...(args[1] ?? {}) }).then((res) => res.json() as Promise<T>)
  })
}
export const cachedJSON = async <T extends object>(
  key: string,
  signal: AbortSignal,
  fn: (signal: AbortSignal) => Promise<T>,
  { ttl = defaultTTL }: { ttl?: number } = {},
) => {
  const cached = await getCachedRequest(key)
  if (cached) {
    return JSON.parse(cached.value) as T
  }
  const result = (await fn(signal)) as T
  await insertCacheRequest({
    key,
    value: JSON.stringify(result),
    expiresAt: new Date(Date.now() + ttl),
  })
  return result
}
