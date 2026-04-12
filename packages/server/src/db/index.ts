/**
 * @module db
 * Database query layer — all Drizzle ORM operations for tokens, images, lists, providers.
 *
 * Key export: `applyOrder()` — builds a CTE with `dense_rank()` window function to
 * return images ordered by provider ranking, list version, and format preference.
 * The `dedupe` flag controls whether only rank-1 images are returned (image endpoints)
 * or all rows (token list endpoints). The `sorted` flag adds an outer ORDER BY.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as viem from 'viem'
import { failureLog, responseToBuffer, type ChainId } from '@gibs/utils'
import * as paths from '../paths'
import * as fileType from 'file-type'
import { sanitizeImage } from '../sanitize'
import * as utils from '../utils'
import { imageMode } from './tables'
import type {
  InsertableList,
  InsertableListToken,
  InsertableProvider,
  InsertableToken,
  List,
  Network,
  InsertableListOrder,
  BackfillableInsertableListOrderItem,
  InsertableBridge,
  Bridge,
  InsertableBridgeLink,
  InsertableHeaderLink,
  InsertableCacheRequest,
  InsertableImageVariant,
} from './schema-types'
import { fetch } from '../fetch'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import * as args from '../args'
import { getDrizzle, type DrizzleTx } from './drizzle'
import { eq, and, lt, gte, desc, ilike, inArray, sql as dsql, type SQL } from 'drizzle-orm'
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

/** Run pending database migrations. */
export { migrate } from './drizzle'

/** Run a Drizzle transaction. */
export const transaction = async <T>(fn: (tx: DrizzleTx) => Promise<T>): Promise<T> => {
  return getDrizzle().transaction(fn)
}

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
  tx?: DrizzleTx,
) => {
  const db = tx ?? getDrizzle()
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
  // Reject raster images that are too small to be real logos (e.g. CoinGecko thumb placeholders)
  const MIN_RASTER_SIZE = 200
  const isSvg = ext === '.svg' || ext === '.svg+xml'
  if (!isSvg && image.length < MIN_RASTER_SIZE) {
    failureLog('image too small (%d bytes) %o -> %o', image.length, providerKey, originalUri)
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
    db
      .insert(s.image)
      .values(insertable)
      .onConflictDoUpdate({
        target: s.image.imageHash,
        set: { content: dsql`excluded.content`, mode: dsql`excluded.mode`, uri: dsql`excluded.uri` },
      })
      .returning(),
  ])
  // this fails for some reason when the db creates the image hash
  // figure out why
  // if (imageHash !== inserted.imageHash) {
  //   log(insertable, inserted, imageHash)
  //   throw new Error('image hash mismatch')
  // } else {
  //   log('image hash match %o', imageHash)
  // }
  const [link] = await db
    .insert(s.link)
    .values({
      uri: originalUri,
      imageHash: inserted.imageHash,
    })
    .onConflictDoUpdate({
      target: s.link.uri,
      set: { uri: dsql`excluded.uri` },
    })
    .returning()
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

export const insertToken = async (token: InsertableToken, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const [inserted] = await db
    .insert(s.token)
    .values({
      tokenId: dsql`''`,
      type: 'erc20',
      ...token,
      name: token.name.split('\x00').join(''),
      symbol: token.symbol.split('\x00').join(''),
    })
    .onConflictDoUpdate({
      target: s.token.tokenId,
      set: { tokenId: dsql`excluded.token_id` },
    })
    .returning()
  return inserted
}

export const getImageFromLink = async (uri: string, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const [link] = await db.select().from(s.link).where(eq(s.link.uri, uri)).limit(1)
  if (!link) return null
  const [image] = await db.select().from(s.image).where(eq(s.image.imageHash, link.imageHash)).limit(1)
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
export const getFreshImageFromLink = async (uri: string, maxAgeMs: number, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
  const [link] = await db
    .select()
    .from(s.link)
    .where(and(eq(s.link.uri, uri), gte(s.link.updatedAt, cutoff)))
    .limit(1)
  if (!link) return null
  const [image] = await db.select().from(s.image).where(eq(s.image.imageHash, link.imageHash)).limit(1)
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
export const insertTokenBatch = async (tokens: InsertableToken[], tx?: DrizzleTx) => {
  if (!tokens.length) return []
  const db = tx ?? getDrizzle()
  const cleaned = tokens.map((token) => {
    let providedId = token.providedId
    if (viem.isAddress(providedId)) {
      providedId = viem.getAddress(providedId)
    }
    return {
      tokenId: dsql`''` as unknown as string,
      type: 'erc20' as const,
      ...token,
      providedId,
      name: token.name.split('\x00').join(''),
      symbol: token.symbol.split('\x00').join(''),
    }
  })
  // PG has a ~65535 parameter limit; 7 columns per row → max ~500 rows per batch
  const chunkSize = 500
  const results: (typeof s.token.$inferSelect)[] = []
  for (let i = 0; i < cleaned.length; i += chunkSize) {
    const chunk = cleaned.slice(i, i + chunkSize)
    const rows = await db
      .insert(s.token)
      .values(chunk)
      .onConflictDoUpdate({
        target: s.token.tokenId,
        set: { tokenId: dsql`excluded.token_id` },
      })
      .returning()
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
  tx?: DrizzleTx,
) => {
  const insertedToken = await insertToken({ type: 'erc20', ...token }, tx)
  const [listToken] = await insertListToken(
    {
      tokenId: insertedToken.tokenId,
      listId,
      imageHash,
      listTokenOrderId,
    },
    tx,
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
  tx?: DrizzleTx,
) => {
  if (!tokenImages.length) return []
  const db = tx ?? getDrizzle()

  // Use promiseLimit to control concurrency
  const limit = promiseLimit(8) // Limit to 8 concurrent image fetches

  const results = await Promise.allSettled(
    tokenImages.map((item) =>
      limit(async () => {
        if (!item.uri) return null

        try {
          const resolved = await resolveImage(item.uri, item.signal, item.providerKey)
          if (!resolved) return null

          // Store the image
          const imageResult = await insertImage(
            {
              providerKey: item.providerKey,
              originalUri: resolved.originalUri,
              image: resolved.buffer,
              listId: null, // We'll update the listToken separately
            },
            tx,
          )

          if (!imageResult) {
            return { listTokenId: item.listTokenId, success: false, error: 'Failed to insert image' }
          }

          const { image } = imageResult

          // Update the list token with the image hash
          await db
            .update(s.listToken)
            .set({ imageHash: image.imageHash })
            .where(eq(s.listToken.listTokenId, item.listTokenId))

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
  tx?: DrizzleTx,
) => {
  const db = tx ?? getDrizzle()
  const [network] = await db
    .select()
    .from(s.network)
    .where(eq(s.network.chainId, String(chainId)))
    .limit(1)
  if (!network) return null
  const [token] = await db
    .select()
    .from(s.token)
    .where(and(eq(s.token.providedId, address), eq(s.token.networkId, network.networkId)))
    .limit(1)
  if (!token) return null
  const conditions = [eq(s.listToken.tokenId, token.tokenId)]
  if (providerId) {
    conditions.push(eq(s.list.providerId, providerId))
  }
  const [listTokenRow] = await db
    .select()
    .from(s.listToken)
    .innerJoin(s.list, eq(s.list.listId, s.listToken.listId))
    .where(and(...conditions))
    .limit(1)
  const listTokens = listTokenRow ? { ...listTokenRow.list_token, ...listTokenRow.list } : undefined
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
  tx?: DrizzleTx,
) => {
  const db = tx ?? getDrizzle()
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
  }
  if (_.isString(uri)) {
    const existing = await getFreshImageFromLink(uri, maxImageAge, tx)
    if (existing) {
      const list = await getListFromId(listId, tx)
      if (list && list.imageHash && list.imageHash === existing.image.imageHash) {
        return {
          ...existing,
          list,
        }
      }
    }
  }
  if (!uri || !originalUri) {
    const list = await getListFromId(listId, tx)
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
    tx,
  )
  if (!img) {
    return
  }
  const [list] = await db
    .update(s.list)
    .set({ imageHash: img.image.imageHash })
    .where(eq(s.list.listId, listId))
    .returning()
  return {
    list,
    ...img,
  }
}

export const getListFromId = async (listId: string, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
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
  tx?: DrizzleTx,
) => {
  const db = tx ?? getDrizzle()
  if (!originalUri && _.isString(uri)) {
    originalUri = uri
  }
  if (_.isString(uri)) {
    const existing = await getFreshImageFromLink(uri, maxImageAge, tx)
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
  return db.transaction(async (innerTx) => {
    const img = await insertImage(
      {
        originalUri,
        image,
        providerKey,
        listId: `${network.chainId}`,
      },
      innerTx,
    )
    if (!img) {
      return
    }
    const [ntwrk] = await innerTx
      .update(s.network)
      .set({ imageHash: img.image.imageHash })
      .where(eq(s.network.networkId, network.networkId))
      .returning()
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
  tx?: DrizzleTx,
) => {
  const db = tx ?? getDrizzle()
  const maxImageAge = header.maxImageAge ?? sixHours
  if (_.isString(header.uri)) {
    const existing = await getFreshImageFromLink(header.uri, maxImageAge, tx)
    if (existing) return
  }
  const image = await fetchImage(header.uri, header.signal, header.providerKey, header.listTokenId)
  if (!image) {
    return
  }
  await db.transaction(async (innerTx) => {
    const result = await insertImage(
      {
        providerKey: header.providerKey,
        originalUri: header.originalUri,
        image,
        listId: header.listTokenId,
      },
      innerTx,
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
      innerTx,
    )
    return inserted
  })
}

export const insertHeaderLink = async (header: InsertableHeaderLink, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  return await db
    .insert(s.headerLink)
    .values(header)
    .onConflictDoUpdate({
      target: s.headerLink.listTokenId,
      set: { listTokenId: dsql`excluded.list_token_id` },
    })
    .returning()
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
  tx?: DrizzleTx,
): Promise<{
  token: typeof s.token.$inferSelect
  listToken: typeof s.listToken.$inferSelect
  link?: typeof s.link.$inferSelect
  image?: typeof s.image.$inferSelect
}> => {
  const db = tx ?? getDrizzle()
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
  const getListToken = async (tokenId: string, imageHash: string) => {
    const [row] = await db
      .select({
        tokenId: s.listToken.tokenId,
        listId: s.listToken.listId,
        imageHash: s.listToken.imageHash,
        listTokenId: s.listToken.listTokenId,
        listTokenOrderId: s.listToken.listTokenOrderId,
        createdAt: s.listToken.createdAt,
        updatedAt: s.listToken.updatedAt,
      })
      .from(s.listToken)
      .innerJoin(s.token, eq(s.token.tokenId, s.listToken.tokenId))
      .where(
        and(
          eq(s.token.networkId, token.networkId),
          eq(s.token.providedId, token.providedId),
          eq(s.listToken.listId, listId),
          eq(s.listToken.imageHash, imageHash),
          eq(s.listToken.tokenId, tokenId),
        ),
      )
      .limit(1)
    return row
  }
  if (_.isString(uri)) {
    const existing = await getFreshImageFromLink(uri, maxImageAge, tx)
    if (existing) {
      const insertedToken = await insertToken(
        {
          type: 'erc20',
          ...token,
          providedId,
        },
        tx,
      )
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
        tx,
      )
    }
  }
  const insertedToken = await insertToken(
    {
      type: 'erc20',
      ...token,
      providedId,
    },
    tx,
  )
  const [listToken] = await insertListToken(
    {
      tokenId: insertedToken.tokenId,
      listId,
      imageHash: img?.image.imageHash,
      listTokenOrderId,
    },
    tx,
  )
  return {
    token: insertedToken,
    listToken,
    ...(img || {}),
  }
}

export const insertListToken = async (listToken: InsertableListToken | InsertableListToken[], tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const items = Array.isArray(listToken) ? listToken : [listToken]
  const values = items.map((lt) => ({
    listTokenId: dsql`''` as unknown as string,
    ...lt,
  }))
  return await db
    .insert(s.listToken)
    .values(values)
    .onConflictDoUpdate({
      target: s.listToken.listTokenId,
      set: { listTokenId: dsql`excluded.list_token_id` },
    })
    .returning()
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
  return db
    .update(s.list)
    .set(list as Record<string, unknown>)
    .returning()
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
  tx?: DrizzleTx,
) => {
  const run = async (innerTx: DrizzleTx) => {
    const [o] = await innerTx
      .insert(s.listOrder)
      .values({
        listOrderId: dsql`''`,
        ...order,
      })
      .onConflictDoUpdate({
        target: s.listOrder.listOrderId,
        set: { listOrderId: dsql`excluded.list_order_id` },
      })
      .returning()
    const deduped = new Map(orderItems.map((i) => [i.ranking, i]))
    const insertableItems = [...deduped.values()].map((i) => ({
      ...i,
      listOrderId: o.listOrderId,
      listId: i.listId ?? null,
    }))
    if (!insertableItems.length) {
      return { order: o, listOrderItems: [] }
    }
    const items = await innerTx
      .insert(s.listOrderItem)
      .values(insertableItems)
      .onConflictDoUpdate({
        target: [s.listOrderItem.listOrderId, s.listOrderItem.ranking],
        set: {
          listOrderId: dsql`excluded.list_order_id`,
          ranking: dsql`excluded.ranking`,
        },
      })
      .returning()
    return {
      order: o,
      listOrderItems: items,
    }
  }
  if (tx) return run(tx)
  return getDrizzle().transaction(run)
}

export const getTokensUnderListId = () => {
  return getDrizzle()
    .select({
      chainId: s.network.chainId,
      providedId: s.token.providedId,
      decimals: s.token.decimals,
      symbol: s.token.symbol,
      name: s.token.name,
      tokenId: s.token.tokenId,
      imageHash: s.image.imageHash,
      ext: s.image.ext,
      mode: s.image.mode,
      uri: s.image.uri,
      providerKey: s.provider.key,
      listKey: s.list.key,
    })
    .from(s.listToken)
    .leftJoin(s.image, eq(s.image.imageHash, s.listToken.imageHash))
    .innerJoin(s.token, eq(s.token.tokenId, s.listToken.tokenId))
    .innerJoin(s.network, eq(s.network.networkId, s.token.networkId))
    .innerJoin(s.list, eq(s.list.listId, s.listToken.listId))
    .innerJoin(s.provider, eq(s.provider.providerId, s.list.providerId))
    .$dynamic()
}

export const getLists = async (providerKey: string, listKey: string) => {
  const db = getDrizzle()
  const whereClause = listKey
    ? and(eq(s.provider.key, providerKey), eq(s.list.key, listKey))
    : and(eq(s.provider.key, providerKey), eq(s.list.default, true))
  return db
    .select()
    .from(s.provider)
    .innerJoin(s.list, eq(s.list.providerId, s.provider.providerId))
    .innerJoin(s.listToken, eq(s.listToken.listId, s.list.listId))
    .fullJoin(s.image, eq(s.image.imageHash, s.list.imageHash))
    .where(whereClause)
    .orderBy(desc(s.list.major), desc(s.list.minor), desc(s.list.patch))
}

/**
 * Add header URI extension columns via a full join on headerLink.
 * NOTE: Drizzle `$dynamic()` supports adding joins but NOT new select columns.
 * We include the join here; the extra columns come through as part of the
 * headerLink table's fields in the join result. Callers reading
 * `headerListTokenId` / `headerImageHash` must access them from the
 * `header_link` portion of the flattened row.
 */
/**
 * Recursively convert an object's keys from snake_case to camelCase.
 * Used to post-process row_to_json() results, which return DB column names.
 */
const camelCaseKeys = (obj: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (!obj) return null
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [_.camelCase(k), v]))
}

/**
 * Fetch tokens under a list with bridge and/or header extensions via raw SQL.
 *
 * Drizzle's $dynamic() can add JOINs but NOT SELECT columns. The old Knex code
 * used row_to_json() to embed joined tables as nested JSON objects, plus a global
 * postProcessResponse to camelCase all keys. This function reproduces that behavior
 * using raw SQL (same pattern as applyOrder).
 */
export const getTokensWithExtensions = async (
  listId: string,
  { bridgeInfo = false, headerUri = false }: { bridgeInfo?: boolean; headerUri?: boolean } = {},
) => {
  const db = getDrizzle()
  const result = await db.execute<Record<string, unknown>>(dsql`
    SELECT
      "network"."chain_id" AS "chainId",
      "token"."provided_id" AS "providedId",
      "token"."decimals",
      "token"."symbol",
      "token"."name",
      "token"."token_id" AS "tokenId",
      "image"."image_hash" AS "imageHash",
      "image"."ext",
      "image"."mode",
      "image"."uri",
      "provider"."key" AS "providerKey",
      "list"."key" AS "listKey"
      ${
        bridgeInfo
          ? dsql`
        , row_to_json("bridge".*) AS "bridge"
        , row_to_json("bridge_link".*) AS "bridgeLink"
        , row_to_json("network_a".*) AS "networkA"
        , row_to_json("network_b".*) AS "networkB"
        , row_to_json("native_token".*) AS "nativeToken"
        , row_to_json("bridged_token".*) AS "bridgedToken"
      `
          : dsql``
      }
      ${
        headerUri
          ? dsql`
        , "header_link"."image_hash" AS "headerImageHash"
      `
          : dsql``
      }
    FROM "list_token"
    FULL JOIN "image" ON "image"."image_hash" = "list_token"."image_hash"
    INNER JOIN "token" ON "token"."token_id" = "list_token"."token_id"
    INNER JOIN "network" ON "network"."network_id" = "token"."network_id"
    INNER JOIN "list" ON "list"."list_id" = "list_token"."list_id"
    INNER JOIN "provider" ON "provider"."provider_id" = "list"."provider_id"
    ${
      bridgeInfo
        ? dsql`
      FULL JOIN "bridge_link" ON (
        "bridge_link"."native_token_id" = "token"."token_id"
        OR "bridge_link"."bridged_token_id" = "token"."token_id"
      )
      INNER JOIN "bridge" ON "bridge"."bridge_id" = "bridge_link"."bridge_id"
      INNER JOIN "network" AS "network_a" ON "network_a"."network_id" = "bridge"."home_network_id"
      INNER JOIN "network" AS "network_b" ON "network_b"."network_id" = "bridge"."foreign_network_id"
      INNER JOIN "token" AS "native_token" ON "native_token"."token_id" = "bridge_link"."native_token_id"
      INNER JOIN "token" AS "bridged_token" ON "bridged_token"."token_id" = "bridge_link"."bridged_token_id"
    `
        : dsql``
    }
    ${
      headerUri
        ? dsql`
      FULL JOIN "header_link" ON "header_link"."list_token_id" = "list_token"."list_token_id"
    `
        : dsql``
    }
    WHERE "list_token"."list_id" = ${listId}
    ORDER BY "list_token"."list_token_order_id" ASC
  `)
  if (!bridgeInfo) return result.rows
  return result.rows.map((row) => ({
    ...row,
    bridge: camelCaseKeys(row.bridge as Record<string, unknown> | null),
    bridgeLink: camelCaseKeys(row.bridgeLink as Record<string, unknown> | null),
    networkA: camelCaseKeys(row.networkA as Record<string, unknown> | null),
    networkB: camelCaseKeys(row.networkB as Record<string, unknown> | null),
    nativeToken: camelCaseKeys(row.nativeToken as Record<string, unknown> | null),
    bridgedToken: camelCaseKeys(row.bridgedToken as Record<string, unknown> | null),
  }))
}

export const getListOrderId = async (orderParam: string) => {
  if (!orderParam) return null

  const db = getDrizzle()

  // Try lookup by key first (e.g. "default")
  const [byKey] = await db.select().from(s.listOrder).where(eq(s.listOrder.key, orderParam)).limit(1)
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
    const [listOrder] = await db
      .select()
      .from(s.listOrder)
      .where(ilike(s.listOrder.listOrderId, `%${hex.replace(/^0x/, '')}%`))
      .limit(1)
    if (listOrder) return listOrder.listOrderId as viem.Hex
  } else {
    // Verify the hex order ID exists in the DB
    const [exact] = await db
      .select({ listOrderId: s.listOrder.listOrderId })
      .from(s.listOrder)
      .where(eq(s.listOrder.listOrderId, hex))
      .limit(1)
    if (exact) return exact.listOrderId as viem.Hex
  }

  return null
}

/**
 * Build a SQL CASE expression that ranks image extensions by preference.
 * Each group in the preference list gets a lower (better) rank.
 * Extensions not in any group get a fallback rank at the end.
 *
 * @param formatPreference - Ordered groups of extensions, e.g. [['.svg','.svg+xml'], ['.webp'], ['.png']]
 *   Empty array → default SVG-first ordering.
 */
const buildFormatOrderSql = (formatPreference?: string[][]): SQL => {
  if (!formatPreference?.length) {
    return dsql`CASE WHEN ${s.image.ext} IN ('.svg', '.svg+xml') THEN 0 WHEN ${s.image.ext} = '.webp' THEN 1 ELSE 2 END`
  }
  const chunks: SQL[] = [dsql`CASE`]
  for (let i = 0; i < formatPreference.length; i++) {
    const group = formatPreference[i]
    chunks.push(dsql` WHEN ${inArray(s.image.ext, group)} THEN ${i}`)
  }
  chunks.push(dsql` ELSE ${formatPreference.length} END`)
  return dsql.join(chunks, dsql``)
}

/**
 * Apply dense-rank ordering to select the top image per token.
 * When no format preference is given, SVGs are preferred over raster images.
 *
 * Uses raw SQL because Drizzle's $dynamic() cannot add SELECT columns
 * (dense_rank window function) after initial query creation.
 *
 * @param listOrderId - The ordering to apply
 * @param whereClause - Additional SQL WHERE conditions (e.g., chain filter)
 * @param baseFrom - Which base FROM/JOIN set to use:
 *   'listToken' (default) - starts from list_token with full outer join to image (getTokensUnderListId style)
 *   'provider'  - starts from provider with right joins to list/list_token/token/image (getListTokens style)
 * @param formatPreference - Ordered groups of extensions for format sorting
 */
export const applyOrder = async (
  listOrderId: viem.Hex,
  whereClause: SQL,
  baseFrom: 'listToken' | 'provider' = 'listToken',
  formatPreference?: string[][],
  { dedupe = true, sorted = false, includeContent = false }: { dedupe?: boolean; sorted?: boolean; includeContent?: boolean } = {},
) => {
  const db = getDrizzle()
  const formatOrder = buildFormatOrderSql(formatPreference)
  const fromClause =
    baseFrom === 'provider'
      ? dsql`
        ${s.provider}
        RIGHT JOIN ${s.list} ON ${eq(s.list.providerId, s.provider.providerId)}
        RIGHT JOIN ${s.listToken} ON ${eq(s.listToken.listId, s.list.listId)}
        RIGHT JOIN ${s.token} ON ${eq(s.token.tokenId, s.listToken.tokenId)}
        INNER JOIN ${s.network} ON ${eq(s.network.networkId, s.token.networkId)}
        RIGHT JOIN ${s.image} ON ${eq(s.image.imageHash, s.listToken.imageHash)}
      `
      : dsql`
        ${s.listToken}
        LEFT JOIN ${s.image} ON ${eq(s.image.imageHash, s.listToken.imageHash)}
        INNER JOIN ${s.token} ON ${eq(s.token.tokenId, s.listToken.tokenId)}
        INNER JOIN ${s.network} ON ${eq(s.network.networkId, s.token.networkId)}
        INNER JOIN ${s.list} ON ${eq(s.list.listId, s.listToken.listId)}
        INNER JOIN ${s.provider} ON ${eq(s.provider.providerId, s.list.providerId)}
      `
  const rows = await db.execute<Record<string, unknown>>(dsql`
    WITH ls AS (
      SELECT
        ${s.network.chainId} AS "chainId",
        ${s.token.providedId} AS "providedId",
        ${s.token.decimals},
        ${s.token.symbol},
        ${s.token.name},
        ${s.token.tokenId} AS "tokenId",
        ${s.image.imageHash} AS "imageHash",
        ${s.image.ext},
        ${s.image.mode},
        ${s.image.uri},
        ${includeContent ? dsql`${s.image.content},` : dsql``}
        ${s.provider.key} AS "providerKey",
        ${s.list.key} AS "listKey",
        ${s.listToken.listTokenOrderId} AS "listTokenOrderId",
        ${s.list.major} AS "listMajor",
        ${s.list.minor} AS "listMinor",
        ${s.list.patch} AS "listPatch",
        ${s.list.default} AS "listDefault",
        COALESCE(${s.listOrderItem.ranking}, 9223372036854775807) AS "listRanking",
        dense_rank() OVER (
          PARTITION BY ${s.token.tokenId}, ${s.token.networkId}
          ORDER BY
            (COALESCE(${s.listOrderItem.ranking}, 9223372036854775807) / 1000) ASC,
            ${formatOrder} ASC,
            ${s.list.major} DESC, ${s.list.minor} DESC, ${s.list.patch} DESC,
            ${s.list.default} ASC,
            ${s.list.key} ASC,
            ${s.listToken.listTokenOrderId} ASC
        ) AS rank
      FROM ${fromClause}
      LEFT JOIN ${s.listOrderItem} ON (
        ${eq(s.listOrderItem.listKey, s.list.key)}
        AND ${eq(s.listOrderItem.providerId, s.list.providerId)}
        AND ${s.listOrderItem.listOrderId} = ${listOrderId}
      )
      WHERE ${whereClause}
    )
    SELECT ls.* FROM ls ${dedupe ? dsql`WHERE ls.rank = 1` : dsql``}
    ${sorted ? dsql`ORDER BY (ls."listRanking" / 1000) ASC, ls."listMajor" DESC, ls."listMinor" DESC, ls."listPatch" DESC, ls."listDefault" ASC, ls."listKey" ASC, ls."listTokenOrderId" ASC` : dsql``}
  `)
  return rows.rows
}

/**
 * Optimized query for /list/tokens/:chainId — uses LATERAL + LIMIT 1 to
 * pick the best image per token without materializing the full cross-product.
 *
 * Starts from token (filtered by chainId via network), then for each token
 * does an indexed LATERAL lookup into list_token → list → provider → image,
 * sorting only ~2-10 rows per token in memory.
 *
 * Benchmarked at 1.4s for 45k Ethereum tokens vs 60s+ for the dense_rank CTE.
 */
export const getTokensByChain = async (
  listOrderId: viem.Hex,
  chainId: string,
): Promise<Record<string, unknown>[]> => {
  const db = getDrizzle()
  const formatOrder = buildFormatOrderSql()
  const rows = await db.execute<Record<string, unknown>>(dsql`
    SELECT
      ${s.network.chainId} AS "chainId",
      ${s.token.providedId} AS "providedId",
      ${s.token.decimals},
      ${s.token.symbol},
      ${s.token.name},
      ${s.token.tokenId} AS "tokenId",
      best.*
    FROM ${s.token}
    INNER JOIN ${s.network} ON ${eq(s.network.networkId, s.token.networkId)}
    CROSS JOIN LATERAL (
      SELECT
        ${s.image.imageHash} AS "imageHash",
        ${s.image.ext},
        ${s.image.mode},
        ${s.image.uri},
        ${s.provider.key} AS "providerKey",
        ${s.list.key} AS "listKey",
        ${s.listToken.listTokenOrderId} AS "listTokenOrderId",
        ${s.list.major} AS "listMajor",
        ${s.list.minor} AS "listMinor",
        ${s.list.patch} AS "listPatch",
        ${s.list.default} AS "listDefault",
        COALESCE(${s.listOrderItem.ranking}, 9223372036854775807) AS "listRanking"
      FROM ${s.listToken}
      INNER JOIN ${s.list} ON ${eq(s.list.listId, s.listToken.listId)}
      INNER JOIN ${s.provider} ON ${eq(s.provider.providerId, s.list.providerId)}
      LEFT JOIN ${s.image} ON ${eq(s.image.imageHash, s.listToken.imageHash)}
      LEFT JOIN ${s.listOrderItem} ON (
        ${eq(s.listOrderItem.listKey, s.list.key)}
        AND ${eq(s.listOrderItem.providerId, s.list.providerId)}
        AND ${s.listOrderItem.listOrderId} = ${listOrderId}
      )
      WHERE ${eq(s.listToken.tokenId, s.token.tokenId)}
      ORDER BY
        (COALESCE(${s.listOrderItem.ranking}, 9223372036854775807) / 1000) ASC,
        ${formatOrder} ASC,
        ${s.list.major} DESC, ${s.list.minor} DESC, ${s.list.patch} DESC,
        ${s.list.default} ASC,
        ${s.list.key} ASC,
        ${s.listToken.listTokenOrderId} ASC
      LIMIT 1
    ) best
    WHERE ${s.network.chainId} = ${chainId}
  `)
  return rows.rows
}

export const getVariant = async (imageHash: string, width: number, height: number, format: string, tx?: DrizzleTx) => {
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

export const insertVariant = async (variant: InsertableImageVariant, tx?: DrizzleTx): Promise<void> => {
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

export const pruneVariants = async (minAccessCount = 3, maxAgeHours = 24, tx?: DrizzleTx): Promise<number> => {
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

export const insertBridge = async (bridge: InsertableBridge, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  // Knex InsertableBridge has block numbers as string; Drizzle schema uses bigint mode: 'number'.
  // The pg driver handles both at runtime — cast to satisfy Drizzle's type system during transition.
  const values = { bridgeId: dsql`''`, ...bridge } as unknown as typeof s.bridge.$inferInsert
  const [b] = await db
    .insert(s.bridge)
    .values(values)
    .onConflictDoUpdate({
      target: s.bridge.bridgeId,
      set: { bridgeId: dsql`excluded.bridge_id` },
    })
    .returning()
  return b
}

export const insertBridgeLink = async (bridgeLink: InsertableBridgeLink, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const [bl] = await db
    .insert(s.bridgeLink)
    .values({
      bridgeLinkId: dsql`''` as unknown as string,
      ...bridgeLink,
    })
    .onConflictDoUpdate({
      target: s.bridgeLink.bridgeLinkId,
      set: { bridgeLinkId: dsql`excluded.bridge_link_id` },
    })
    .returning()
  return bl
}

export const updateBridgeBlockProgress = (bridgeId: string, updates: Partial<Bridge>, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  return db
    .update(s.bridge)
    .set(updates as Record<string, unknown>)
    .where(eq(s.bridge.bridgeId, bridgeId))
}

export const getBridge = async (bridgeId: string, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const [row] = await db.select().from(s.bridge).where(eq(s.bridge.bridgeId, bridgeId)).limit(1)
  return row
}

export const getLatestBridgeToken = async (bridgeId: string, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const [row] = await db
    .select({ count: dsql<number>`count(*)` })
    .from(s.bridgeLink)
    .innerJoin(s.token, eq(s.token.tokenId, s.bridgeLink.bridgedTokenId))
    .where(eq(s.bridgeLink.bridgeId, bridgeId))
    .orderBy(desc(s.bridgeLink.bridgeLinkId))
    .limit(1)
  return row
}

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
    expiresAt: new Date(Date.now() + ttl).toISOString(),
  })
  return result
}
