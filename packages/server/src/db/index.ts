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
import { detectImageExt } from '../image-format'
import { sanitizeImage } from '../sanitize'
import { isPlaceholderImage, isPlaceholderUri, placeholderByteLengths } from '../image-placeholders'
import { toCAIP2, namespaceOf, expectedNetworkType, isFakedEvmReference, TEST_NETWORK_TYPE } from '../chain-id'
import * as utils from '../utils'
import config from '../../config'
import { imageMode } from './tables'
import type {
  InsertableList,
  InsertableListToken,
  InsertableProvider,
  InsertableToken,
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
import { eq, and, lt, gte, desc, ilike, inArray, sql as dsql, type SQL, type AnyColumn } from 'drizzle-orm'
import * as s from './schema'
import { noteListTokensWritten } from './publication'
import { normalizeProvidedId, canonicalBridgeAddress } from './provided-id'
import { escapeLikePattern, SEARCH_CANDIDATE_CAP } from './search'
import { collectablePriority } from '../collect/collectable-order'

// Re-exported so collectors can use db.normalizeProvidedId without importing the leaf module.
export { normalizeProvidedId }

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
  const ext = await detectImageExt(image, path.extname(originalUri))
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
  // Some sources answer a logo they do not hold with a generic "no artwork"
  // graphic under HTTP 200 rather than a 404, so it arrives here looking like
  // any other image. Storing one is worse than storing nothing: it ranks by its
  // provider's priority like real artwork would, and DexScreener sits high
  // enough that its question-mark icon was outranking genuine chain logos from
  // every fallback below it.
  if (isPlaceholderImage(sanitized)) {
    failureLog('placeholder image %o -> %o', providerKey, originalUri)
    return null
  }
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
  // A list that names its placeholder honestly can be turned away before the
  // request is made. Treated as no image at all, which is what the caller would
  // have concluded from a 404 — every one of them already handles that.
  if (isPlaceholderUri(url)) {
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
  // Fail fast on a type that disagrees with the identifier's namespace. A bare
  // numeric id normalizes to eip155-<n>, which may only carry type 'evm'; a
  // non-EVM type must arrive with its own namespaced id (tvm-195, bip122-0).
  // Without this a mis-filing collector silently writes a corrupt row — e.g.
  // smoldapp hashing the "btcm" folder to 1651794797 and typing it 'btc' produced
  // eip155-1651794797/btc, which the UI then renders as a bogus network.
  const canonicalChainId = toCAIP2(chainId.toString())
  // Refuse a non-EVM chain that an upstream list echoed as a bare eip155 number
  // (Solana 900/501000101, Tron 1000/728126428). The dedicated collectors file
  // these under solana-501 / tvm-195, so creating the eip155 form only resurrects
  // the husks the cleanup migrations removed. Collectors isolate this per token.
  if (isFakedEvmReference(canonicalChainId)) {
    throw new Error(
      `chain id "${canonicalChainId}" is a non-Ethereum-Virtual-Machine chain mis-numbered as eip155; collect it under its coin-type id (Solana -> solana-501, Tron -> tvm-195) instead.`,
    )
  }
  const expectedType = expectedNetworkType(canonicalChainId)
  if (type !== expectedType && type !== TEST_NETWORK_TYPE) {
    throw new Error(
      `network type "${type}" conflicts with chain id "${canonicalChainId}": its "${namespaceOf(canonicalChainId)}" namespace requires type "${expectedType}". Pass a namespaced id (e.g. tvm-195, bip122-0) for non-Ethereum-Virtual-Machine chains rather than a bare number.`,
    )
  }
  // networkId is generated by a DB trigger from (type, chainId) — provide placeholder for Drizzle's type system
  const [network] = await db
    .insert(s.network)
    .values({
      networkId: dsql`''`,
      type,
      chainId: canonicalChainId,
    })
    .onConflictDoUpdate({
      target: s.network.networkId,
      set: { networkId: dsql`excluded.network_id` },
    })
    .returning()
  return network
}

/**
 * Record what a registry calls a network: its display `name` and its longer prose
 * `title`, which arrive together on one chains.json entry.
 *
 * Deliberately separate from insertNetworkFromChainId. That funnel is the one entry
 * point every collector shares, and almost none of them know a name — they resolve a
 * chain id from a token list and nothing more. Only a collector reading a registry
 * that publishes naming (chainlist, from ethereum-lists) has any to write, so this is
 * its own narrow write rather than extra arguments thirty call sites would have to
 * pass as undefined.
 *
 * Blank values are skipped rather than stored, per field: null already means "nothing
 * from upstream" and lets consumers fall back, whereas an empty string would read as a
 * real value — rendering a blank label, or suppressing a testnet match. Skipping per
 * field also means a chain that loses its title upstream keeps the name it had.
 */
export const setNetworkNaming = async (
  { networkId, name, title }: { networkId: string; name?: string | null; title?: string | null },
  tx?: DrizzleTx,
) => {
  const set: { name?: string; title?: string } = {}
  const trimmedName = name?.trim()
  const trimmedTitle = title?.trim()
  if (trimmedName) set.name = trimmedName
  if (trimmedTitle) set.title = trimmedTitle
  if (!Object.keys(set).length) return
  const db = tx ?? getDrizzle()
  await db.update(s.network).set(set).where(eq(s.network.networkId, networkId))
}

export const getNetworks = (tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  return db.select().from(s.network)
}

/**
 * Stored networks sharing a bare numeric reference, each flagged with whether any
 * token sits behind it — '501' yields [{eip155-501, false}, {solana-501, true}].
 * Lets a namespace-less request resolve to the namespace that actually holds the
 * tokens instead of assuming eip155; see resolveChainIdAgainstStored.
 *
 * EXISTS rather than COUNT: the resolver only needs populated-or-not, and EXISTS
 * stops at the first row instead of scanning a chain's entire token set.
 */
export const getChainIdsByReference = async (
  reference: string,
  tx?: DrizzleTx,
): Promise<{ chainId: string; hasTokens: boolean }[]> => {
  const db = tx ?? getDrizzle()
  const rows = await db.execute<{ chainId: string; hasTokens: boolean }>(dsql`
    SELECT ${s.network.chainId} AS "chainId",
           EXISTS (SELECT 1 FROM ${s.token} WHERE ${eq(s.token.networkId, s.network.networkId)}) AS "hasTokens"
    FROM ${s.network}
    WHERE split_part(${s.network.chainId}, '-', 2) = ${reference}
  `)
  return rows.rows.map((row) => ({ chainId: row.chainId, hasTokens: Boolean(row.hasTokens) }))
}

export const insertToken = async (token: InsertableToken, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  // Target the (network_id, provided_id) unique constraint rather than the PK so
  // citext case-insensitive equality catches duplicates with different casing
  // (e.g. existing "0xABC" row vs new "0xabc" insert).
  const [inserted] = await db
    .insert(s.token)
    .values({
      tokenId: dsql`''`,
      type: 'erc20',
      ...token,
      providedId: normalizeProvidedId(token.providedId),
      name: token.name.split('\x00').join(''),
      symbol: token.symbol.split('\x00').join(''),
    })
    .onConflictDoUpdate({
      target: [s.token.networkId, s.token.providedId],
      set: { tokenId: dsql`token.token_id` },
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
 *
 * A fresh link whose bytes are a known upstream placeholder counts as missing.
 * This is the single funnel through which a stored image is reused instead of
 * downloaded, and every caller reuses it by claiming a slot or linking a token —
 * neither of which passes through `insertImage`, where the placeholder guard
 * lives. Without this check, the guard only ever sees the first download of a
 * given address: once a placeholder is on disk it is fresh for a week
 * (IMAGE_MAX_AGE_HOURS) and re-attaches itself on every run in between, which is
 * exactly what was observed in production — a sweep released twenty-one chain
 * icon slots and DexScreener took nineteen of them straight back from cache,
 * without a single network request.
 *
 * Reporting it as absent sends the caller down the download path, where
 * `insertImage` rejects it once and the chain is recorded as having no artwork.
 * That costs one request per placeholder address per run, against twenty-one
 * addresses.
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
  if (image.content && isPlaceholderImage(image.content)) return null
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
  const ext = await detectImageExt(image, path.extname(originalUri))
  if (!ext) return null
  return { buffer: image, ext, originalUri }
}

/**
 * Batch insert tokens. Returns all upserted token records.
 */
export const insertTokenBatch = async (tokens: InsertableToken[], tx?: DrizzleTx) => {
  if (!tokens.length) return []
  const db = tx ?? getDrizzle()
  const cleaned = tokens.map((token) => ({
    tokenId: dsql`''` as unknown as string,
    type: 'erc20' as const,
    ...token,
    providedId: normalizeProvidedId(token.providedId),
    name: token.name.split('\x00').join(''),
    symbol: token.symbol.split('\x00').join(''),
  }))
  // PG has a ~65535 parameter limit; 7 columns per row → max ~500 rows per batch
  const chunkSize = 500
  const results: (typeof s.token.$inferSelect)[] = []
  for (let i = 0; i < cleaned.length; i += chunkSize) {
    const chunk = cleaned.slice(i, i + chunkSize)
    const rows = await db
      .insert(s.token)
      .values(chunk)
      .onConflictDoUpdate({
        target: [s.token.networkId, s.token.providedId],
        set: { tokenId: dsql`token.token_id` },
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
 *
 * A logo already on disk and inside its freshness window is reused rather than
 * downloaded again — see the guard in the loop below for why that is not merely an
 * optimisation.
 */
export const batchFetchImagesForTokens = async (
  tokenImages: {
    listTokenId: string
    uri: string | null
    originalUri: string | null
    providerKey: string
    signal?: AbortSignal
    /** Overrides the shared freshness window for this item. Defaults to IMAGE_MAX_AGE_HOURS. */
    maxImageAge?: number
  }[],
  tx?: DrizzleTx,
) => {
  if (!tokenImages.length) return []
  const db = tx ?? getDrizzle()

  /**
   * Point a list_token at the image it should serve. Runs on both the reuse and the
   * download path: cached bytes say nothing about whether *this* list_token — which
   * may belong to a list version created minutes ago — already references them.
   */
  const linkListTokenToImage = async (listTokenId: string, imageHash: string) => {
    await db.update(s.listToken).set({ imageHash }).where(eq(s.listToken.listTokenId, listTokenId))
  }

  // Use promiseLimit to control concurrency
  const limit = promiseLimit(8) // Limit to 8 concurrent image fetches

  // Every task below resolves: the body is wrapped in a total try/catch that
  // turns any failure into a `success: false` entry, so one bad image degrades
  // its own row instead of the batch. That is what makes plain `all` safe here.
  const results = await Promise.all(
    tokenImages.map((item) =>
      limit(async () => {
        if (!item.uri) return null

        try {
          // Every other fetch path in this module checks for a fresh link before going to
          // the network — fetchImageAndStoreForToken, fetchImageAndStoreForNetwork,
          // fetchAndInsertHeader, prewarmImages. This one did not, so it re-downloaded
          // every logo it had ever seen on every run, sanitized the bytes again, and
          // rewrote rows that were already byte-identical. The freshness window exists
          // precisely so a collect cron does not do that.
          //
          // Only the download is skipped. The list_token still gets linked below, because
          // cached bytes tell us nothing about whether this list_token points at them yet.
          const fresh = await getFreshImageFromLink(item.uri, item.maxImageAge ?? defaultImageMaxAge, tx)
          if (fresh) {
            await linkListTokenToImage(item.listTokenId, fresh.image.imageHash)
            return { listTokenId: item.listTokenId, success: true, image: fresh.image }
          }

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
          await linkListTokenToImage(item.listTokenId, image.imageHash)

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
    result,
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
    .where(eq(s.network.chainId, toCAIP2(String(chainId))))
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
    maxImageAge = defaultImageMaxAge,
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

/**
 * Release every network icon slot currently pointing at a known upstream
 * placeholder, so the run that follows can fill it with real artwork.
 *
 * This is the other half of the guard in `insertImage`. That guard stops new
 * placeholders from ever being stored, which means no slot can acquire one from
 * here on; this clears the ones written before it existed. Ranking cannot undo
 * them on its own — `claimNetworkImageSlot` compares priorities, and DexScreener
 * outranks every fallback that carries the real chain icons, so its question
 * mark would keep the slot against all of them indefinitely.
 *
 * A released slot leaves the network with no icon at all, which is the honest
 * answer for a chain nothing else covers: a consumer can see it is absent and
 * fall back, whereas a question mark is indistinguishable from artwork until a
 * person looks at it.
 *
 * Candidates are narrowed by byte length in the database so this hashes a
 * handful of rows rather than every stored icon.
 *
 * @returns the chain identifiers whose slots were released.
 */
export const purgePlaceholderNetworkIcons = async (tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const candidates = await db
    .select({
      networkId: s.network.networkId,
      chainId: s.network.chainId,
      content: s.image.content,
    })
    .from(s.network)
    .innerJoin(s.image, eq(s.image.imageHash, s.network.imageHash))
    .where(inArray(dsql`octet_length(${s.image.content})`, [...placeholderByteLengths]))
  const stale = candidates.filter((row) => isPlaceholderImage(row.content))
  if (!stale.length) return []
  await db
    .update(s.network)
    .set({ imageHash: null, imageProviderKey: null })
    .where(
      inArray(
        s.network.networkId,
        stale.map((row) => row.networkId),
      ),
    )
  return stale.map((row) => row.chainId)
}

/**
 * Every table that can hold a reference to an image.
 *
 * `image_variant` is deliberately absent. It is a cache derived from an image
 * rather than a use of one, so it never justifies keeping the image alive — it
 * is cleared alongside the row it derives from. `link` is listed but, for a
 * placeholder, the sweep clears its rows before the guard is ever evaluated, so
 * the check against it only catches one written concurrently.
 *
 * A table missing from this list would let the sweep below delete a row that
 * table still points at, which is why `index.image.test.ts` rebuilds the list
 * from the schema and fails when the two disagree.
 */
const imageReferrers = [s.network, s.list, s.listToken, s.link, s.headerLink] as const

/**
 * `NOT EXISTS` against every referrer, correlated on `column`, so a delete can
 * establish that nothing points at a row as part of the same statement that
 * removes it.
 *
 * Deciding this in a separate read first would be a real hazard rather than a
 * stylistic one: two of the five foreign keys onto `image` are declared
 * `ON DELETE CASCADE`, so a row that acquired a reference between the read and
 * the delete would not raise an error — it would take a `list` or `header_link`
 * row down with it.
 */
const unreferencedBy = (column: AnyColumn): SQL[] =>
  imageReferrers.map((table) => dsql`not exists (select 1 from ${table} where ${table.imageHash} = ${column})`)

/**
 * Delete every stored placeholder image nothing points at any more, along with
 * any resized copies cached from it.
 *
 * `purgePlaceholderNetworkIcons` frees the slot but leaves the row behind, so
 * the bytes accumulate — one image per address a source served its placeholder
 * from, each still fetchable through `/image/direct/<hash>` and each still
 * holding space in the variant cache. Reclaiming them here is what makes the
 * sweep self-healing: the next source that starts answering with a placeholder
 * is cleared by the run that notices it, with no manual step against the
 * database afterwards.
 *
 * A row something still genuinely uses is left alone. The read path already
 * refuses to reuse it, so it is inert where it sits, and removing it would
 * either break a foreign key or cascade into the referring row. It becomes
 * collectable on a later run once the last reference goes.
 *
 * `link` is the exception, and it has to be, because a link row is not a use of
 * an image — it is the collect-time fetch cache, read by nothing outside
 * collection, and `getFreshImageFromLink` already refuses to hand a placeholder
 * back through it. Left standing it would pin its image against the delete
 * below permanently rather than temporarily: `insertImage` writes the link row
 * in the same call that stores the image, and the conflict set on that upsert
 * never re-points `image_hash`, so the reference is frozen at first write and
 * no later run can clear it. Every placeholder ever stored would keep its bytes
 * forever, which is the outcome this function exists to prevent.
 *
 * @returns the hashes of the images deleted.
 */
export const purgeUnreferencedPlaceholderImages = async (tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const candidates = await db
    .select({ imageHash: s.image.imageHash, content: s.image.content })
    .from(s.image)
    .where(inArray(dsql`octet_length(${s.image.content})`, [...placeholderByteLengths]))
  const stale = candidates.filter((row) => isPlaceholderImage(row.content)).map((row) => row.imageHash)
  if (!stale.length) return []
  // The cached fetch result for an address that answers with a placeholder is
  // never worth keeping — re-reading it is precisely what has to stop.
  await db.delete(s.link).where(inArray(s.link.imageHash, stale))
  // Variants go next. Their foreign key onto `image` carries no ON DELETE
  // clause, so the image cannot leave while a resized copy of it remains.
  await db
    .delete(s.imageVariant)
    .where(and(inArray(s.imageVariant.imageHash, stale), ...unreferencedBy(s.imageVariant.imageHash)))
  const deleted = await db
    .delete(s.image)
    .where(and(inArray(s.image.imageHash, stale), ...unreferencedBy(s.image.imageHash)))
    .returning({ imageHash: s.image.imageHash })
  return deleted.map((row) => row.imageHash)
}

/**
 * Point a network's icon slot at `imageHash` on behalf of `providerKey`, but only if
 * that collector outranks whoever currently holds the slot.
 *
 * The slot used to be assigned by an unconditional update, which made the last
 * collector to finish the winner. Six of them write network icons, and the two
 * lowest-priority ones — chainlist and cryptocurrency-icons — are broad fallbacks
 * meant to fill chains nobody curated; chainlist even carries the comment "kept last
 * so any chain-specific logo outranks it". Under last-write-wins it outranked
 * everything instead, and which icon survived came down to collection order, so two
 * deployments of the same code served different icons for the same chain.
 *
 * A row whose provider is unknown — every network written before provenance was
 * recorded — yields to the first collector that claims it, rather than being frozen
 * in place forever. See `collectablePriority`.
 *
 * @returns the network row that now holds the slot, whether or not this call won it.
 */
const claimNetworkImageSlot = async (
  { network, imageHash, providerKey }: { network: Network; imageHash: string; providerKey: string },
  tx?: DrizzleTx,
) => {
  const db = tx ?? getDrizzle()
  const [current] = await db.select().from(s.network).where(eq(s.network.networkId, network.networkId)).limit(1)
  if (current?.imageHash && collectablePriority(current.imageProviderKey) < collectablePriority(providerKey)) {
    return current
  }
  // Already exactly what we would write. Skipping matters at this scale: every
  // collector revisits every network it knows on every run, so an unconditional
  // update here is thousands of no-op writes per run.
  if (current?.imageHash === imageHash && current.imageProviderKey === providerKey) {
    return current
  }
  const [updated] = await db
    .update(s.network)
    .set({ imageHash, imageProviderKey: providerKey })
    .where(eq(s.network.networkId, network.networkId))
    .returning()
  return updated
}

export const fetchImageAndStoreForNetwork = async (
  {
    network,
    uri,
    originalUri,
    providerKey,
    signal,
    maxImageAge = defaultImageMaxAge,
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
    // The bytes are already on disk, so there is nothing to download — but the slot
    // still has to be contested. Returning here without claiming is what made the
    // ranking above unreachable in practice: images stay fresh for a week
    // (IMAGE_MAX_AGE_HOURS, default 168), so on all but the first run after a logo
    // expires every collector took this path and no collector ever reached the
    // comparison. Whichever one happened to win the very first race then held the
    // chain indefinitely, which is the behaviour the ranking was added to end.
    if (existing) {
      const claimed = await claimNetworkImageSlot({ network, imageHash: existing.image.imageHash, providerKey }, tx)
      return { network: claimed ?? network, ...existing }
    }
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
    // Take the slot only if this collector outranks whoever holds it. The image row
    // is written either way — losing the network slot is not a reason to discard
    // bytes another list_token may reference.
    const ntwrk = await claimNetworkImageSlot({ network, imageHash: img.image.imageHash, providerKey }, innerTx)
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
  const maxImageAge = header.maxImageAge ?? defaultImageMaxAge
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

// Default freshness window for a fetched logo before it is re-downloaded.
// Sourced from config (IMAGE_MAX_AGE_HOURS, default 7 days) so it can be tuned
// above the collect cron interval instead of re-fetching every logo each run.
const defaultImageMaxAge = config.imageMaxAgeMs

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
  const { listId, uri, token, providerKey, signal, listTokenOrderId, maxImageAge = defaultImageMaxAge } = inputs
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
  // Hoisted so the fall-through below can reuse what this resolved. The early return
  // needs three things to line up — fresh bytes, unchanged metadata, and an existing
  // list_token at the same order — and when any one of them misses, only the list_token
  // half of the work is actually stale. The bytes are still fresh.
  let existing: Awaited<ReturnType<typeof getFreshImageFromLink>> = null
  if (_.isString(uri)) {
    existing = await getFreshImageFromLink(uri, maxImageAge, tx)
    if (existing) {
      const insertedToken = await insertToken(
        {
          type: 'erc20',
          ...token,
          providedId,
        },
        tx,
      )
      // `listId` is guaranteed present — the function throws on a missing one
      // before reaching here — so only the metadata comparison gates the reuse.
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
  // list must have already been inserted to db by this point
  let img!: Awaited<ReturnType<typeof insertImage>>
  if (existing) {
    // Fresh bytes are already on disk and `link` already points at them, so there is
    // nothing to download and nothing to write — insertImage would upsert both rows to
    // the values they already hold. Only the missing-marker sweep is worth repeating: a
    // previous run may have recorded a miss for this list before another list fetched
    // the image successfully, and that marker is now wrong.
    //
    // Re-fetching here instead is what made a version bump so expensive. The early
    // return above cannot fire on a new version — getListToken is keyed on the new,
    // empty list_id — so every token fell to this branch and downloaded an image the
    // line above had just confirmed fresh, at up to three seconds of timeout each.
    img = existing
    if (originalUri) {
      await removeMissing({
        imageHash: existing.image.imageHash,
        originalUri,
        providerKey,
        listId,
      })
    }
  } else if (uri && originalUri) {
    const image = await fetchImage(uri, signal, providerKey, token.providedId)
    if (!image) {
      // Deliberate: a failed image fetch records the miss but still stores the token
      // (image-less) below — list endpoints filter imageless tokens server-side, and
      // a later collection can attach the image without re-discovering the token.
      await writeMissing({
        providerKey,
        originalUri,
        listId,
      })
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

/**
 * How many logos to download at once in `prewarmImages`.
 *
 * Matches the ceiling `batchFetchImagesForTokens` already uses, and is bounded by what a
 * provider's image host will tolerate rather than by anything local — the work is a fetch
 * with a three-second timeout, so raising this trades politeness for wall clock.
 */
const IMAGE_PREWARM_CONCURRENCY = 8

/**
 * Download every logo a list needs, concurrently, before anything walks its tokens.
 *
 * A collect loop stores tokens one at a time because each one writes several related rows,
 * and that is fine for database work — but it also made every image download wait for the
 * one before it. A list whose logos are cold spent almost all of its time asleep on a
 * socket, in series, at up to three seconds each.
 *
 * This resolves the same images up front and out of order, so the loop that follows finds
 * every link already fresh and does no network work at all (see fetchImageAndStoreForToken,
 * which reuses a fresh link rather than re-fetching). Two things make it cheaper than the
 * sum of its parts: URIs are deduplicated first, and lists routinely point many tokens at
 * one logo; and a URI that fails is reported back so the caller can stop asking for it,
 * instead of every token re-attempting the same dead host.
 *
 * Deliberately not transactional. Each image is independent, nothing downstream reads these
 * rows until the list is published, and holding a transaction open across the downloads is
 * the exact thing this is built to avoid.
 */
export const prewarmImages = async ({
  uris,
  providerKey,
  listId,
  signal,
  maxImageAge = defaultImageMaxAge,
  concurrency = IMAGE_PREWARM_CONCURRENCY,
}: {
  uris: (string | null | undefined)[]
  providerKey: string
  listId: string | null
  signal?: AbortSignal
  maxImageAge?: number
  concurrency?: number
}): Promise<{ distinct: number; fetched: number; missing: Set<string> }> => {
  const distinct = [...new Set(uris.filter((uri): uri is string => typeof uri === 'string' && uri.length > 0))]
  const limit = promiseLimit(concurrency)
  const missing = new Set<string>()
  let fetched = 0
  await Promise.all(
    distinct.map((uri) =>
      limit(async () => {
        if (signal?.aborted) return
        // Already on disk and inside its freshness window — nothing to do, and the loop
        // downstream will find exactly this row.
        if (await getFreshImageFromLink(uri, maxImageAge)) return
        const image = await fetchImage(uri, signal, providerKey)
        if (!image) {
          // Recorded here rather than left for the loop, because the caller blanks these
          // URIs on the strength of this set. The token is still stored, image-less, which
          // is what happened before when the fetch failed inside the loop instead.
          missing.add(uri)
          await writeMissing({ providerKey, originalUri: uri, listId })
          return
        }
        await insertImage({ providerKey, originalUri: uri, image, listId })
        fetched += 1
      }),
    ),
  )
  return { distinct: distinct.length, fetched, missing }
}

export const insertListToken = async (listToken: InsertableListToken | InsertableListToken[], tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  const items = Array.isArray(listToken) ? listToken : [listToken]
  const values = items.map((lt) => ({
    listTokenId: dsql`''` as unknown as string,
    ...lt,
  }))
  const written = await db
    .insert(s.listToken)
    .values(values)
    .onConflictDoUpdate({
      target: s.listToken.listTokenId,
      // The primary key is keccak256(token_id || list_id) — it deliberately excludes
      // image_hash — so re-collecting an existing (token, list) pair conflicts. Without
      // refreshing these columns the row's icon froze at first write: a provider that
      // later changed an icon URL (e.g. Internet Money moving off Heroku) would keep
      // serving the original image forever. COALESCE preserves a prior image when this
      // run fetched none (transient failure, or the deliberate image-less store), so a
      // good icon is never clobbered by a later NULL.
      set: {
        imageHash: dsql`COALESCE(excluded.image_hash, ${s.listToken.imageHash})`,
        listTokenOrderId: dsql`excluded.list_token_order_id`,
      },
    })
    .returning()
  // Every `list_token` insert in the codebase funnels through here, which is what lets
  // publication be derived rather than remembered — see ./publication. Noting the rows
  // that came back rather than the ones asked for keeps the ledger honest about what the
  // statement actually touched. A no-op outside a tracked collector run.
  for (const row of written) {
    noteListTokensWritten(row.listId)
  }
  return written
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
      // `tokens_collected_at` is deliberately absent. A conflict here means the same
      // version — `list_id` hashes the version tuple, so a bump inserts instead of
      // conflicting — and a version that has already published must not be pulled back
      // out of view just because collection ran over it again. Re-collecting an existing
      // version only upserts its tokens, which never removes anything, so what is
      // published stays correct throughout. Adding it to this set would blank the marker
      // on every run and hide every list until its collection finished.
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

/**
 * Publish a list version: mark it as having finished writing its `list_token` rows.
 *
 * This is the single atomic step that swings readers from the previous version to this
 * one. Call it only after the whole token list has been walked — see latestListVersionSql
 * for why a version must not become visible before then. Individual token failures are
 * not a reason to withhold it: the collect loop logs and skips them, so "walked the whole
 * list" is the honest guarantee, and withholding on one bad token would strand the list on
 * a stale version indefinitely. An abort or a throw out of the loop must skip this.
 *
 * Idempotent, and re-collecting an already-published version simply refreshes the
 * timestamp.
 *
 * Calling this is optional. A collector that says nothing still has its lists published by
 * ./publication once its collect phase finishes; what an explicit call buys is granularity,
 * publishing one list the moment it is done instead of waiting for the rest of the run.
 * That matters for inmemory-tokenlist, which is invoked once per list and is the only
 * caller that bumps versions.
 */
export const markListTokensCollected = async (listId: string, tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  return await db
    .update(s.list)
    .set({ tokensCollectedAt: dsql`CURRENT_TIMESTAMP` })
    .where(eq(s.list.listId, listId))
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

/**
 * Resolve a provider's lists (one row per version, newest first), with the metadata the
 * list endpoints serve. Returns only lists that have at least one token — the same
 * "populated lists" contract the old query enforced with an innerJoin on `list_token`.
 *
 * That join returned ONE ROW PER TOKEN (thousands for a large list) purely to prove the
 * list was non-empty, and it made the endpoint O(tokens): getLists, not the token-body
 * query, was the multi-second cost. It is replaced by a correlated `EXISTS`, which stops
 * at the first token and returns one row per list.
 *
 * Columns are selected explicitly rather than spread from `SELECT *`. The old callers did
 * `{ ...list, ...image, ...provider, ...list_token }`, and because `list_token` was spread
 * last and carries its own `image_hash` and `updated_at`, the response's `logoURI` was
 * built from an ARBITRARY token's image hash (with the list logo's extension — a
 * mismatched url) and its `timestamp` was an arbitrary token's update time. Selecting
 * `list.image_hash` and `list.updated_at` here is what fixes both: the logo is the list's
 * own, and the timestamp is when the list changed. `name` stays the provider's, matching
 * the prior precedence (provider was spread after list), deliberately unchanged.
 */
export const getLists = async (providerKey: string, listKey: string) => {
  const db = getDrizzle()
  const hasTokens = dsql`EXISTS (SELECT 1 FROM ${s.listToken} WHERE ${eq(s.listToken.listId, s.list.listId)})`
  const query = (whereClause: SQL | undefined) =>
    db
      .select({
        listId: s.list.listId,
        name: s.provider.name,
        imageHash: s.list.imageHash,
        ext: s.image.ext,
        mode: s.image.mode,
        uri: s.image.uri,
        updatedAt: s.list.updatedAt,
        major: s.list.major,
        minor: s.list.minor,
        patch: s.list.patch,
      })
      .from(s.provider)
      .innerJoin(s.list, eq(s.list.providerId, s.provider.providerId))
      .leftJoin(s.image, eq(s.image.imageHash, s.list.imageHash))
      .where(whereClause ? and(whereClause, hasTokens) : hasTokens)
      .orderBy(desc(s.list.major), desc(s.list.minor), desc(s.list.patch))
  const whereClause = listKey
    ? and(eq(s.provider.key, providerKey), eq(s.list.key, listKey))
    : and(eq(s.provider.key, providerKey), eq(s.list.default, true))
  const rows = await query(whereClause)
  // Fall back to any list for this provider if no default exists
  if (rows.length === 0 && !listKey) {
    return query(eq(s.provider.key, providerKey))
  }
  return rows
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
    -- LEFT, not FULL. The full outer half only ever produced rows with a null
    -- list_token, which the WHERE below discards anyway, so the two are equivalent
    -- here — but only by accident of the WHERE clause, and a full outer join is the
    -- more expensive plan. The optional header join further down reads the same way.
    LEFT JOIN "image" ON "image"."image_hash" = "list_token"."image_hash"
    INNER JOIN "token" ON "token"."token_id" = "list_token"."token_id"
    INNER JOIN "network" ON "network"."network_id" = "token"."network_id"
    INNER JOIN "list" ON "list"."list_id" = "list_token"."list_id"
    INNER JOIN "provider" ON "provider"."provider_id" = "list"."provider_id"
    ${
      bridgeInfo
        ? // Every join in this chain must be a LEFT JOIN. Only a minority of tokens
          // are bridged, so `bridge_link` is absent for most rows; an INNER JOIN
          // anywhere below it drops those rows outright rather than returning them
          // without bridge columns. That is not a degraded response, it is an empty
          // one — asking a list for `?extensions=bridgeInfo` returned zero tokens
          // where the same list without extensions returned thousands. Requesting an
          // extension must never remove tokens from a list.
          dsql`
      LEFT JOIN "bridge_link" ON (
        "bridge_link"."native_token_id" = "token"."token_id"
        OR "bridge_link"."bridged_token_id" = "token"."token_id"
      )
      LEFT JOIN "bridge" ON "bridge"."bridge_id" = "bridge_link"."bridge_id"
      LEFT JOIN "network" AS "network_a" ON "network_a"."network_id" = "bridge"."home_network_id"
      LEFT JOIN "network" AS "network_b" ON "network_b"."network_id" = "bridge"."foreign_network_id"
      LEFT JOIN "token" AS "native_token" ON "native_token"."token_id" = "bridge_link"."native_token_id"
      LEFT JOIN "token" AS "bridged_token" ON "bridged_token"."token_id" = "bridge_link"."bridged_token_id"
    `
        : dsql``
    }
    ${
      headerUri
        ? dsql`
      LEFT JOIN "header_link" ON "header_link"."list_token_id" = "list_token"."list_token_id"
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

  // Try as hex listOrderId. Ids are stored unprefixed and lowercase — see
  // `ids` above, where every generator slices the leading "0x" off a keccak
  // hash — so both lookups below compare against that form, not the caller's.
  const normalized = orderParam.toLowerCase()
  const candidate = normalized.startsWith('0x') ? normalized.slice(2) : normalized
  if (!candidate || !viem.isHex(`0x${candidate}`)) return null

  const fullIdLength = 64
  if (candidate.length === fullIdLength) {
    const [exact] = await db
      .select({ listOrderId: s.listOrder.listOrderId })
      .from(s.listOrder)
      .where(eq(s.listOrder.listOrderId, candidate))
      .limit(1)
    return exact ? (exact.listOrderId as viem.Hex) : null
  }

  // Anything shorter is a prefix or fragment of an id, which only a scan can resolve.
  const [listOrder] = await db
    .select()
    .from(s.listOrder)
    .where(ilike(s.listOrder.listOrderId, `%${candidate}%`))
    .limit(1)
  return listOrder ? (listOrder.listOrderId as viem.Hex) : null
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
    // NULL ext (no image) ranks worst (3); other formats rank 2; WebP 1; SVG 0.
    return dsql`CASE WHEN ${s.image.ext} IN ('.svg', '.svg+xml') THEN 0 WHEN ${s.image.ext} = '.webp' THEN 1 WHEN ${s.image.ext} IS NOT NULL THEN 2 ELSE 3 END`
  }
  const chunks: SQL[] = [dsql`CASE`]
  for (let i = 0; i < formatPreference.length; i++) {
    const group = formatPreference[i]
    chunks.push(dsql` WHEN ${inArray(s.image.ext, group)} THEN ${i}`)
  }
  // NULL (no image) always ranks after every explicit group.
  chunks.push(
    dsql` WHEN ${s.image.ext} IS NOT NULL THEN ${formatPreference.length} ELSE ${formatPreference.length + 1} END`,
  )
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
  {
    dedupe = true,
    sorted = false,
    includeContent = false,
  }: { dedupe?: boolean; sorted?: boolean; includeContent?: boolean } = {},
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
            CASE WHEN ${s.image.imageHash} IS NOT NULL THEN 0 ELSE 1 END ASC,
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
 * SQL twin of the JS `directUri()` truthiness check in utils: a usable image is
 * link-mode with a non-empty uri, or any other mode with a non-empty ext. Every SQL
 * site must stay in lockstep with directUri() — empty strings are falsy in JS and
 * make `.filter(e => e.logoURI)` drop the row — or stats counts drift from list
 * totals. Build the predicate only here.
 */
const usableImageSql = (mode: SQL | AnyColumn, uri: SQL | AnyColumn, ext: SQL | AnyColumn): SQL =>
  dsql`((${mode} = 'link' AND COALESCE(${uri}, '') <> '') OR (${mode} <> 'link' AND COALESCE(${ext}, '') <> ''))`

/**
 * Restricts `list` to the newest version of each list, where a list is identified by
 * its (provider_id, key) pair and versions are ordered by (major, minor, patch).
 *
 * Every collection run that sees a changed list writes a new `list` row and keeps the
 * old one, along with all of its `list_token` rows. Nothing ever removed them, so the
 * superseded versions dominate: on Ethereum they are 1,067,093 of the 1,246,904
 * `list_token` rows on staging and 505,756 of 685,898 on production, while the newest
 * versions come to roughly 180,000 rows in both. The genuine working set is that
 * 180,000; the rest is accumulation that grows with every run.
 *
 * Those rows were never able to change an answer. The ranking already sorts
 * `major DESC, minor DESC, patch DESC` and `DISTINCT ON (token_id)` keeps the first
 * row, so a superseded version only ever won when no newer version carried the token.
 * Filtering here decides that case the same way the sort would if the row were absent,
 * and stops the other million rows from being read, joined and sorted to be discarded.
 *
 * The one behavioural consequence is deliberate: a token that its source list has since
 * removed stops being served. That is 909 of 98,374 tokens on Ethereum. They are
 * delistings, and continuing to serve them was the accident.
 *
 * Ties cannot arise. Verified against both deployed databases: all 1,193 distinct
 * (provider_id, key) pairs have fully distinct versions, and none has two rows sharing
 * the highest one, so exactly one row survives per pair.
 *
 * Only a version that has finished collecting is allowed to supersede one, which is what
 * the `tokens_collected_at` test is for. Collection commits the `list` row in `discover()`
 * and writes its `list_token` rows in a later phase, so a new version exists and is
 * incomplete for as long as that phase takes. Without the guard the unfinished row wins on
 * version number and takes the complete older one out of the answer with it.
 *
 * This condition was originally `EXISTS (a list_token for the newer row)`, which fixed only
 * the empty case — seven lists were sitting in it — and left the partial one open: a version
 * caught halfway through its writes has rows, so it superseded, and everything it had not
 * rewritten yet went missing. That window is not brief. The early return in
 * fetchImageAndStoreForToken that normally avoids the network is gated on finding an
 * existing `list_token` for this `list_id`, and a fresh version has none, so every token
 * takes the full path including a fetch with a three-second timeout.
 *
 * `collect()` sets the marker in one row update once it has walked the whole list, so the
 * switchover is atomic even though the rows behind it were written piecemeal. Migration
 * 0014 backfilled exactly those lists that already held a token, which makes this
 * equivalent to the old predicate at deploy and stricter only as later runs go by.
 *
 * Every list is covered, not just the ones inmemory-tokenlist walks. The dozen collectors
 * that write `list` rows directly say nothing about publication; ./publication derives it
 * for them from the `list_token` writes they made, and publishes the lot when their
 * collect phase finishes. So a collector may be given a real version without the author
 * knowing this predicate exists, which is the point — the previous arrangement was safe
 * only for as long as every one of them kept passing a constant version.
 */
const latestListVersionSql: SQL = dsql`
  NOT EXISTS (
    SELECT 1 FROM ${s.list} newer
    WHERE newer.provider_id = ${s.list.providerId}
      AND newer.key = ${s.list.key}
      AND (newer.major, newer.minor, newer.patch) > (${s.list.major}, ${s.list.minor}, ${s.list.patch})
      AND newer.tokens_collected_at IS NOT NULL
  )`

/**
 * High-performance ranked token query for /list/tokens/:chainId.
 *
 * Uses DISTINCT ON (token_id) over a flat join, with list rankings pre-aggregated
 * in a materialized CTE (one row per list), instead of a dense_rank() window
 * function that materialized and globally sorted every list_token row for the
 * chain. For Ethereum mainnet this is ~10–50x faster.
 *
 * Returns one row per token (the best-ranked list entry), in provider-ranking order.
 * Concurrency dedup lives in the caller (buildAndCacheTokensByChain single-flights
 * the whole build: this query, the sources query, and the JSON serialization).
 */
export const getTokensByChainRanked = async (
  chainId: string,
  listOrderId: viem.Hex,
  { bridgeInfo = false, headerUri = false }: { bridgeInfo?: boolean; headerUri?: boolean } = {},
): Promise<Record<string, unknown>[]> => {
  const db = getDrizzle()

  // list_order_item has up to 141 duplicate rows per (list_order_id, provider_id, list_key)
  // triple. Without deduplication, the LEFT JOIN multiplies list_token rows by 3-141x,
  // ballooning the sort to millions of rows and timing out Ethereum (1M list_token rows).
  // Pre-aggregating with MIN(ranking) in a CTE gives exactly one row per list.
  const rows = await db.execute<Record<string, unknown>>(dsql`
    WITH list_ranks AS MATERIALIZED (
      SELECT ${s.list.listId}, ${s.list.key}, ${s.list.major}, ${s.list.minor},
             ${s.list.patch}, ${s.list.default}, ${s.list.providerId},
             COALESCE(MIN(${s.listOrderItem.ranking}), 9223372036854775807) AS ranking
      FROM ${s.list}
      LEFT JOIN ${s.listOrderItem} ON (
        ${s.listOrderItem.listOrderId} = ${listOrderId}
        AND ${eq(s.listOrderItem.providerId, s.list.providerId)}
        AND ${eq(s.listOrderItem.listKey, s.list.key)}
      )
      WHERE ${latestListVersionSql}
      GROUP BY ${s.list.listId}
    )
    SELECT
      sub."chainId",
      sub."providedId",
      sub.decimals,
      sub.symbol,
      sub.name,
      sub."tokenId",
      sub."imageHash",
      sub.ext,
      sub.mode,
      sub.uri,
      ${s.provider.key} AS "providerKey",
      sub."listKey",
      sub."listTokenOrderId",
      sub."listMajor",
      sub."listMinor",
      sub."listPatch",
      sub."listDefault",
      sub."listRanking"
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
      ${headerUri ? dsql`, "header_link"."image_hash" AS "headerImageHash"` : dsql``}
    FROM (
      SELECT DISTINCT ON (${s.token.tokenId})
        ${s.network.chainId} AS "chainId",
        ${s.token.providedId} AS "providedId",
        ${s.token.decimals},
        ${s.token.symbol},
        ${s.token.name},
        ${s.token.tokenId} AS "tokenId",
        ${s.listToken.imageHash} AS "imageHash",
        ${s.image.ext} AS ext,
        ${s.image.mode} AS mode,
        ${s.image.uri} AS uri,
        lr.provider_id AS "providerId",
        lr.key AS "listKey",
        ${s.listToken.listTokenId} AS "listTokenId",
        ${s.listToken.listTokenOrderId} AS "listTokenOrderId",
        lr.major AS "listMajor",
        lr.minor AS "listMinor",
        lr.patch AS "listPatch",
        lr.default AS "listDefault",
        lr.ranking AS "listRanking"
      FROM ${s.token}
      INNER JOIN ${s.network} ON ${eq(s.network.networkId, s.token.networkId)}
      INNER JOIN ${s.listToken} ON ${eq(s.listToken.tokenId, s.token.tokenId)}
      INNER JOIN list_ranks lr ON lr.list_id = ${s.listToken.listId}
      LEFT JOIN ${s.image} ON ${eq(s.image.imageHash, s.listToken.imageHash)}
      WHERE ${eq(s.network.chainId, chainId)}
      ORDER BY
        ${s.token.tokenId},
        -- Prefer list_tokens whose image resolves via directUri() (see usableImageSql).
        CASE WHEN ${usableImageSql(s.image.mode, s.image.uri, s.image.ext)} THEN 0 ELSE 1 END ASC,
        (lr.ranking / 1000) ASC,
        lr.major DESC, lr.minor DESC, lr.patch DESC,
        lr.default ASC, lr.key ASC, ${s.listToken.listTokenOrderId} ASC
    ) sub
    INNER JOIN ${s.provider} ON ${eq(s.provider.providerId, dsql.raw('sub."providerId"'))}
    ${
      // Joined outside the DISTINCT ON, deliberately. Inside it, a token bridged to
      // several chains would keep one link and lose the rest — DISTINCT ON returns a
      // single row per token. Out here the ranking pick is already settled, and the
      // fan-out is what normalizeTokens wants: it groups rows by address and folds
      // every one of them into a single entry's bridgeInfo map.
      bridgeInfo
        ? dsql`
      LEFT JOIN "bridge_link" ON (
        "bridge_link"."native_token_id" = sub."tokenId"
        OR "bridge_link"."bridged_token_id" = sub."tokenId"
      )
      LEFT JOIN "bridge" ON "bridge"."bridge_id" = "bridge_link"."bridge_id"
      LEFT JOIN "network" AS "network_a" ON "network_a"."network_id" = "bridge"."home_network_id"
      LEFT JOIN "network" AS "network_b" ON "network_b"."network_id" = "bridge"."foreign_network_id"
      LEFT JOIN "token" AS "native_token" ON "native_token"."token_id" = "bridge_link"."native_token_id"
      LEFT JOIN "token" AS "bridged_token" ON "bridged_token"."token_id" = "bridge_link"."bridged_token_id"
    `
        : dsql``
    }
    ${headerUri ? dsql`LEFT JOIN "header_link" ON "header_link"."list_token_id" = sub."listTokenId"` : dsql``}
    ORDER BY
      (sub."listRanking" / 1000) ASC,
      CASE WHEN ${usableImageSql(dsql.raw('sub.mode'), dsql.raw('sub.uri'), dsql.raw('sub.ext'))} THEN 0 ELSE 1 END ASC,
      sub."listMajor" DESC, sub."listMinor" DESC, sub."listPatch" DESC,
      sub."listDefault" ASC, sub."listKey" ASC, sub."listTokenOrderId" ASC
  `)
  if (!bridgeInfo) return rows.rows
  // row_to_json hands back the database's own snake_case column names; normalizeTokens
  // reads camelCase off these nested objects. Same conversion getTokensWithExtensions
  // applies to the identical shape.
  return rows.rows.map((row) => ({
    ...row,
    bridge: camelCaseKeys(row.bridge as Record<string, unknown> | null),
    bridgeLink: camelCaseKeys(row.bridgeLink as Record<string, unknown> | null),
    networkA: camelCaseKeys(row.networkA as Record<string, unknown> | null),
    networkB: camelCaseKeys(row.networkB as Record<string, unknown> | null),
    nativeToken: camelCaseKeys(row.nativeToken as Record<string, unknown> | null),
    bridgedToken: camelCaseKeys(row.bridgedToken as Record<string, unknown> | null),
  }))
}

/**
 * Lightweight sources query for /list/tokens/:chainId.
 * Returns one row per (token, provider, list) membership — used to populate
 * the `sources` field in token list responses without loading full token data.
 * Paired with getTokensByChainRanked() which handles token dedup via DISTINCT ON.
 */
export const getTokenSourcesByChain = async (
  chainId: string,
): Promise<{ providedId: string; providerKey: string; listKey: string }[]> => {
  const db = getDrizzle()
  // SELECT DISTINCT dedupes (token, provider, list) triples — a token in multiple
  // versions of the same list would otherwise produce duplicate rows. For Ethereum
  // this drops ~1M rows to a fraction of that.
  //
  // Filtered to the newest list version for the same reason as getTokensByChainRanked,
  // and it has to be the same filter: this query decides which lists a token is
  // reported as belonging to, and that ranking query decides which tokens exist at all.
  // Were only one of them filtered, a response could name a source list for a token the
  // other half had already dropped.
  return db
    .selectDistinct({
      providedId: s.token.providedId,
      providerKey: s.provider.key,
      listKey: s.list.key,
    })
    .from(s.listToken)
    .innerJoin(s.token, eq(s.token.tokenId, s.listToken.tokenId))
    .innerJoin(s.network, eq(s.network.networkId, s.token.networkId))
    .innerJoin(s.list, eq(s.list.listId, s.listToken.listId))
    .innerJoin(s.provider, eq(s.provider.providerId, s.list.providerId))
    .where(and(eq(s.network.chainId, chainId), latestListVersionSql))
}

/**
 * Substring search over every token on every chain, for GET /list/search.
 *
 * This exists because the interface had no server-side search to call. It fanned out
 * instead: one request per provider list, every list downloaded in full, filtered in the
 * browser. That is 1,193 lists and hundreds of megabytes to answer one query, and it is
 * the reason the endpoint below is worth its complexity.
 *
 * Runs in two stages, and which work sits in which stage is the whole design.
 *
 * The first stage reads `token`, scores each match, and cuts to the candidate limit.
 * Everything it needs to rank by has to be available here, because this is where rows
 * are discarded: a signal applied after the cut is only sorting whatever the cut kept.
 * That is two things. The relevance tier — exact address, then exact symbol, then symbol
 * prefix, then name prefix, then plain substring, which is what someone typing into a
 * search box means by "best match". And how many list entries carry the token, as a
 * correlated count, which is what separates the token people use from the several
 * hundred that merely share its symbol.
 *
 * Getting that second signal into this stage rather than the next one is the difference
 * between the endpoint working and not. A search for "usdc" matches 1,396 tokens, nearly
 * all of them with the symbol USDC, so the tier alone cannot separate them; ranked
 * afterwards, the answer was "Anubis Bridged USDC (Anubis)" and USD Coin was never a
 * candidate at all.
 *
 * The second stage resolves the winning list entry for the surviving candidates only,
 * using the same DISTINCT ON preference getTokensByChainRanked uses: a list entry whose
 * image actually resolves wins, then provider ranking, then version. Provider ranking
 * enters the final ordering only as a tie-break, after tier and popularity — it orders
 * providers, and a search is asking about tokens. Deciding which list entry a token is
 * served from is the job it can actually do here, and that is the DISTINCT ON.
 *
 * Measured against the real table: 12ms for an address, 17ms for a long term, 57ms for
 * "usdc", and 105ms for a two-character term, all cold and before the response cache.
 *
 * @param query - Raw user input; escaped here, so callers pass it through untouched.
 * @param listOrderId - Provider ranking to resolve against, as elsewhere.
 * @param limit - Candidate ceiling, clamped to SEARCH_CANDIDATE_CAP by the caller.
 * @param chainId - Optional stored identifier (eip155-369) to restrict the search to.
 */
export const searchTokens = async (
  query: string,
  listOrderId: viem.Hex,
  { limit = SEARCH_CANDIDATE_CAP, chainId }: { limit?: number; chainId?: string } = {},
): Promise<Record<string, unknown>[]> => {
  const db = getDrizzle()
  const escaped = escapeLikePattern(query)
  const contains = `%${escaped}%`
  const startsWith = `${escaped}%`
  const rows = await db.execute<Record<string, unknown>>(dsql`
    WITH matched AS (
      SELECT
        ${s.token.tokenId} AS "tokenId",
        ${s.token.networkId} AS "networkId",
        CASE
          WHEN ${s.token.providedId} = ${query} THEN 0
          WHEN lower(${s.token.symbol}) = lower(${query}) THEN 1
          WHEN ${s.token.symbol} ILIKE ${startsWith} THEN 2
          WHEN ${s.token.name} ILIKE ${startsWith} THEN 3
          ELSE 4
        END AS tier,
        (SELECT count(*) FROM ${s.listToken} lt WHERE lt.token_id = ${s.token.tokenId}) AS "listCount"
      FROM ${s.token}
      ${
        // Joined only when asked. An unfiltered search is the common case and the join
        // would otherwise be paid on every request to answer a question nobody asked.
        chainId
          ? dsql`INNER JOIN ${s.network} ON ${eq(s.network.networkId, s.token.networkId)} AND ${eq(s.network.chainId, chainId)}`
          : dsql``
      }
      WHERE ${s.token.name} ILIKE ${contains}
         OR ${s.token.symbol} ILIKE ${contains}
         OR ${s.token.providedId} = ${query}
      -- Popularity ahead of every textual tie-break, and computed here rather than after
      -- the join, because this is the ordering the cut below applies. Ranked afterwards
      -- it would be sorting whatever the cut happened to keep: a search for "usdc"
      -- matches 1,396 tokens that mostly share the symbol, so ordering the cut by name
      -- returned "Anubis Bridged USDC (Anubis)" and USD Coin itself was never a
      -- candidate at all.
      --
      -- The count includes superseded list versions, which overstates a token that has
      -- been in one list a long time relative to one in many lists at once. Measured
      -- against the real table the gap is small — USD Coin scores 22 either way, and the
      -- worst case seen was 12 against 11 — and counting distinct lists needs a join to
      -- the list table per candidate. For a tie-break, the cheap count is the better trade.
      --
      -- Shorter symbols first after that: "PLS" is a likelier target than "PLSPAD" for
      -- someone who typed "pls", and it keeps the cut deterministic between runs.
      ORDER BY tier ASC, "listCount" DESC, length(${s.token.symbol}) ASC, ${s.token.name} ASC
      LIMIT ${limit}
    ),
    list_ranks AS MATERIALIZED (
      SELECT ${s.list.listId}, ${s.list.key}, ${s.list.major}, ${s.list.minor},
             ${s.list.patch}, ${s.list.default}, ${s.list.providerId},
             COALESCE(MIN(${s.listOrderItem.ranking}), 9223372036854775807) AS ranking
      FROM ${s.list}
      LEFT JOIN ${s.listOrderItem} ON (
        ${s.listOrderItem.listOrderId} = ${listOrderId}
        AND ${eq(s.listOrderItem.providerId, s.list.providerId)}
        AND ${eq(s.listOrderItem.listKey, s.list.key)}
      )
      WHERE ${latestListVersionSql}
      GROUP BY ${s.list.listId}
    ),
    best AS (
      SELECT DISTINCT ON (m."tokenId")
        m.tier,
        ${s.network.chainId} AS "chainId",
        ${s.token.providedId} AS "providedId",
        ${s.token.decimals},
        ${s.token.symbol},
        ${s.token.name},
        ${s.listToken.imageHash} AS "imageHash",
        ${s.image.ext} AS ext,
        ${s.image.mode} AS mode,
        ${s.image.uri} AS uri,
        lr.provider_id AS "providerId",
        lr.key AS "listKey",
        lr.ranking AS "listRanking",
        m."listCount"
      FROM matched m
      INNER JOIN ${s.token} ON ${eq(s.token.tokenId, dsql.raw('m."tokenId"'))}
      INNER JOIN ${s.network} ON ${eq(s.network.networkId, dsql.raw('m."networkId"'))}
      INNER JOIN ${s.listToken} ON ${eq(s.listToken.tokenId, dsql.raw('m."tokenId"'))}
      INNER JOIN list_ranks lr ON lr.list_id = ${s.listToken.listId}
      LEFT JOIN ${s.image} ON ${eq(s.image.imageHash, s.listToken.imageHash)}
      ORDER BY
        m."tokenId",
        CASE WHEN ${usableImageSql(s.image.mode, s.image.uri, s.image.ext)} THEN 0 ELSE 1 END ASC,
        (lr.ranking / 1000) ASC,
        lr.major DESC, lr.minor DESC, lr.patch DESC,
        lr.default ASC, lr.key ASC, ${s.listToken.listTokenOrderId} ASC
    )
    SELECT
      b."chainId", b."providedId", b.decimals, b.symbol, b.name,
      b."imageHash", b.ext, b.mode, b.uri, b."listKey",
      ${s.provider.key} AS "providerKey"
    FROM best b
    INNER JOIN ${s.provider} ON ${eq(s.provider.providerId, dsql.raw('b."providerId"'))}
    -- The same keys the candidate cut used, with provider ranking inserted as a
    -- tie-break. It sits after popularity on purpose: ranking orders *providers*, and a
    -- search is asking which *token* was meant. Ranking still decides which list entry a
    -- token is served from — that is the DISTINCT ON above — which is the job it is
    -- actually able to do here.
    ORDER BY
      b.tier ASC,
      b."listCount" DESC,
      (b."listRanking" / 1000) ASC,
      length(b.symbol) ASC,
      b.name ASC
  `)
  return rows.rows
}

/**
 * The (provider, list) pairs whose responses cost the most to assemble, largest first.
 *
 * Used by the provider-list cache warmer to decide what is worth warming. There is no
 * request-count telemetry to rank by popularity, so this ranks by the thing that is
 * actually measurable and actually hurts: how much a cold build has to assemble. Token
 * count tracks that closely — coingecko/ethereum, the largest, takes 3.38s cold against
 * 0.47s for kleros/exchange.
 *
 * Counts only the newest version of each list, matching what the ranked queries serve,
 * so a list with a long tail of superseded versions is not promoted for rows no response
 * contains.
 */
export const getLargestLists = async (limit: number): Promise<{ providerKey: string; listKey: string }[]> => {
  const db = getDrizzle()
  const rows = await db.execute<{ providerKey: string; listKey: string }>(dsql`
    SELECT ${s.provider.key} AS "providerKey", ${s.list.key} AS "listKey"
    FROM ${s.list}
    INNER JOIN ${s.provider} ON ${eq(s.provider.providerId, s.list.providerId)}
    INNER JOIN ${s.listToken} ON ${eq(s.listToken.listId, s.list.listId)}
    WHERE ${latestListVersionSql}
    GROUP BY ${s.provider.key}, ${s.list.key}
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `)
  return rows.rows
}

/**
 * Count distinct tokens per chain that have a usable image. A token counts if it has
 * at least one list_token entry passing usableImageSql (the SQL twin of directUri()).
 * Dedup is by `provided_id` to match normalizeTokens' groupBy of
 * `${chainId}-${normalizeProvidedId(providedId)}`. The column is citext, so DISTINCT is
 * case-insensitive — which agrees with normalizeProvidedId for hex addresses and, for
 * base58 ids, only diverges on case-only variants that do not occur among real mints.
 */
export const getTokenCountsByChain = async (): Promise<{ chainId: string; count: number }[]> => {
  const db = getDrizzle()
  const rows = await db.execute<{ chainId: string; count: string }>(dsql`
    SELECT ${s.network.chainId} AS "chainId", COUNT(DISTINCT ${s.token.providedId})::text AS count
    FROM ${s.token}
    INNER JOIN ${s.network} ON ${eq(s.network.networkId, s.token.networkId)}
    WHERE ${s.network.chainId} != 'asset-0'
      AND EXISTS (
        SELECT 1 FROM ${s.listToken}
        INNER JOIN ${s.image} ON ${eq(s.image.imageHash, s.listToken.imageHash)}
        WHERE ${eq(s.listToken.tokenId, s.token.tokenId)}
          AND ${usableImageSql(s.image.mode, s.image.uri, s.image.ext)}
      )
    GROUP BY ${s.network.chainId}
    ORDER BY COUNT(DISTINCT ${s.token.providedId}) DESC
  `)
  return rows.rows.map((r) => ({ chainId: r.chainId, count: Number(r.count) }))
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
  // Addresses are canonicalized here, at the funnel, so no caller can recreate the
  // casing-duplication bug (see canonicalBridgeAddress for why checksummed, not lowercase).
  const values = {
    bridgeId: dsql`''`,
    ...bridge,
    homeAddress: canonicalBridgeAddress(bridge.homeAddress),
    foreignAddress: canonicalBridgeAddress(bridge.foreignAddress),
  } as unknown as typeof s.bridge.$inferInsert
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

export const clearCache = (tx?: DrizzleTx) => {
  const db = tx ?? getDrizzle()
  return db.delete(s.cacheRequest)
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
  { ttl = defaultTTL, validate }: { ttl?: number; validate?: (result: unknown) => boolean } = {},
) => {
  const cached = await getCachedRequest(key)
  if (cached) {
    const parsed = JSON.parse(cached.value) as T
    // If a validator is provided and the cached value fails it, fall through to re-fetch.
    // This handles previously-cached error responses (e.g. rate-limit JSON bodies).
    if (!validate || validate(parsed)) return parsed
  }
  const result = (await fn(signal)) as T
  // Only cache if the result passes validation
  if (!validate || validate(result)) {
    await insertCacheRequest({
      key,
      value: JSON.stringify(result),
      expiresAt: new Date(Date.now() + ttl).toISOString(),
    })
  }
  return result
}
