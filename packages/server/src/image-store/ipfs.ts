/**
 * @module image-store/ipfs
 * Blob storage on IPFS, written through a pinning service and read back through gateways.
 *
 * - **Write.** Bytes go to the pinning service, which adds them to IPFS and keeps them pinned.
 *   Two request shapes cover the services we use: the Kubo RPC (`/api/v0/add`), which a local
 *   Kubo node and Filebase both speak, and Pinata's `pinFileToIPFS`. Files are added as CIDv1
 *   with raw leaves and 1 MiB blocks, so a small image is a single block.
 * - **Read.** Gateways are tried in order. Whatever one returns is hashed and must equal the
 *   sha256 the blob is named by; a gateway that serves other bytes is skipped. A gateway is
 *   therefore untrusted, and a wrong answer is never returned.
 * - **Names.** sha256 is not a CID, so {@link BlobCidIndex} holds the map (see `cid-index.ts`
 *   for why it is a table). It also answers `stat` and `list`.
 * - **Delete** unpins. Copies that other IPFS nodes already hold are theirs to keep; this store
 *   can only stop paying to hold its own.
 *
 * Only the index can say a blob is missing: no record means no blob, with no network call. A
 * record whose bytes no gateway can serve is an error, never a missing blob.
 */
import { ImageStoreConfigurationError } from './configuration-error'
import type { BlobCidIndex } from './cid-index'
import { hashBytes, assertSha256Hex } from './hash'
import {
  BlobStoreError,
  expectStatus,
  readBytes,
  sendWithRetry,
  type FetchFunction,
  type RemoteStoreEnvironment,
} from './http'
import { log } from '../logger'
import type { BlobStat, BlobStore } from './types'

/** The pinning services the adapter knows. `kubo` is any node that speaks the Kubo RPC, such as a local one. */
export type IpfsProviderName = 'kubo' | 'filebase' | 'pinata'

/** The request shape a provider speaks. */
export type PinningFlavor = 'kubo' | 'pinata'

/** What a provider preset knows. */
export type IpfsProviderPreset = {
  flavor: PinningFlavor
  /** Address of the provider's API. Null when the operator must give it. */
  defaultApiUrl: string | null
  /** Gateways to read through, in order. Empty when the operator must give them. */
  defaultGateways: readonly string[]
}

/**
 * The providers, as data. Filebase and Pinata gateways are the ones `args/ipfs.ts` already
 * uses for the collectors, in the same order.
 */
export const IPFS_PROVIDERS: Readonly<Record<IpfsProviderName, IpfsProviderPreset>> = {
  kubo: { flavor: 'kubo', defaultApiUrl: null, defaultGateways: [] },
  filebase: {
    flavor: 'kubo',
    defaultApiUrl: 'https://rpc.filebase.io',
    defaultGateways: ['https://ipfs.filebase.io/ipfs/'],
  },
  pinata: {
    flavor: 'pinata',
    defaultApiUrl: 'https://api.pinata.cloud',
    defaultGateways: ['https://gateway.pinata.cloud/ipfs/'],
  },
}

/** The provider names, for messages and validation. */
export const IPFS_PROVIDER_NAMES = Object.keys(IPFS_PROVIDERS) as IpfsProviderName[]

/** Block size for added files: the largest a gateway and every pinning service accept as one block. */
export const IPFS_CHUNK_SIZE = 1_048_576

/** Adds bytes to IPFS and removes them again. */
export interface PinningClient {
  /** Adds bytes, keeps them pinned, and returns their content identifier. */
  add(bytes: Uint8Array): Promise<string>
  /** Stops holding the content. Not being pinned is not an error. */
  unpin(cid: string): Promise<void>
}

/** Settings for {@link createPinningClient}. */
export type PinningClientOptions = RemoteStoreEnvironment & {
  flavor: PinningFlavor
  /** Address of the API, with no trailing path. */
  apiUrl: string
  /** Bearer token. Optional for a local node, required for a hosted service. */
  token?: string
}

const withAuthorization = (token: string | undefined): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {}

const fileForm = (bytes: Uint8Array, extra: Record<string, string> = {}): FormData => {
  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart]), 'blob')
  for (const [name, value] of Object.entries(extra)) form.append(name, value)
  return form
}

/**
 * Builds the pinning client for a provider's request shape.
 *
 * @param options See {@link PinningClientOptions}.
 * @returns The client.
 */
export function createPinningClient(options: PinningClientOptions): PinningClient {
  const { flavor, token } = options
  const fetchFunction: FetchFunction = options.fetch ?? fetch
  const apiUrl = options.apiUrl.replace(/\/+$/, '')
  const send = (method: string, url: string, body?: FormData) =>
    sendWithRetry(() => fetchFunction(url, { method, headers: withAuthorization(token), body }), options)

  const kubo: PinningClient = {
    add: async (bytes) => {
      const query = new URLSearchParams({
        'cid-version': '1',
        'raw-leaves': 'true',
        pin: 'true',
        chunker: `size-${IPFS_CHUNK_SIZE}`,
      })
      const response = await expectStatus(
        await send('POST', `${apiUrl}/api/v0/add?${query}`, fileForm(bytes)),
        'ipfs add',
      )
      const lastLine = (await response.text()).trim().split('\n').pop() as string
      const { Hash } = JSON.parse(lastLine) as { Hash?: string }
      if (!Hash) throw new BlobStoreError('ipfs add answered without a content identifier')
      return Hash
    },
    unpin: async (cid) => {
      const response = await send('POST', `${apiUrl}/api/v0/pin/rm?arg=${encodeURIComponent(cid)}`)
      if (response.status === 200) return
      const detail = await response.text()
      if (detail.includes('not pinned')) return
      throw new BlobStoreError(
        `ipfs unpin failed with status ${response.status}: ${detail.slice(0, 300)}`,
        response.status,
      )
    },
  }

  const pinata: PinningClient = {
    add: async (bytes) => {
      const form = fileForm(bytes, { pinataOptions: JSON.stringify({ cidVersion: 1 }) })
      const response = await expectStatus(await send('POST', `${apiUrl}/pinning/pinFileToIPFS`, form), 'pinata add')
      const { IpfsHash } = (await response.json()) as { IpfsHash?: string }
      if (!IpfsHash) throw new BlobStoreError('pinata add answered without a content identifier')
      return IpfsHash
    },
    unpin: async (cid) => {
      const response = await send('DELETE', `${apiUrl}/pinning/unpin/${encodeURIComponent(cid)}`)
      await expectStatus(response, 'pinata unpin', [200, 404])
    },
  }

  return flavor === 'pinata' ? pinata : kubo
}

/** Settings for {@link createIpfsBlobStore}. */
export type IpfsBlobStoreOptions = RemoteStoreEnvironment & {
  pinning: PinningClient
  /** Gateway addresses that end where the CID goes, for example `https://gateway.example/ipfs/`. */
  gateways: readonly string[]
  /** The map from digest to CID. */
  index: BlobCidIndex
}

/**
 * A blob store on IPFS.
 *
 * @param options See {@link IpfsBlobStoreOptions}.
 * @returns The store.
 * @throws ImageStoreConfigurationError when no gateway is given.
 */
export function createIpfsBlobStore(options: IpfsBlobStoreOptions): BlobStore {
  const { pinning, index, now = Date.now } = options
  if (options.gateways.length === 0) throw new ImageStoreConfigurationError('ipfs needs at least one gateway')
  const fetchFunction: FetchFunction = options.fetch ?? fetch
  const gateways = options.gateways.map((gateway) => (gateway.endsWith('/') ? gateway : `${gateway}/`))

  /** The bytes one gateway holds for a CID, or null when it has none or serves the wrong content. */
  const readFromGateway = async (gateway: string, cid: string, sha256: string): Promise<Buffer | null> => {
    const response = await sendWithRetry(() => fetchFunction(`${gateway}${encodeURIComponent(cid)}`), options)
    if (response.status === 404) return null
    const bytes = await readBytes(await expectStatus(response, 'ipfs gateway'))
    if (hashBytes(bytes) === sha256) return bytes
    log('image store: a gateway served bytes that do not match the digest; skipping it')
    return null
  }

  const put = async (bytes: Uint8Array): Promise<BlobStat> => {
    const sha256 = hashBytes(bytes)
    const byteSize = bytes.byteLength
    const known = await index.get(sha256)
    if (known?.byteSize === byteSize) {
      await index.put({ ...known, modifiedAtMs: now() })
      return { sha256, byteSize }
    }
    const cid = await pinning.add(bytes)
    await index.put({ sha256, cid, byteSize, modifiedAtMs: now() })
    return { sha256, byteSize }
  }

  const get = async (sha256: string): Promise<Buffer | null> => {
    const record = await index.get(assertSha256Hex(sha256))
    if (record === null) return null
    const failures: unknown[] = []
    for (const gateway of gateways) {
      try {
        const bytes = await readFromGateway(gateway, record.cid, sha256)
        if (bytes) return bytes
      } catch (error) {
        failures.push(error)
        log('image store: a gateway failed: %o', error)
      }
    }
    throw new BlobStoreError('ipfs get: no gateway returned the blob the index names', undefined, {
      cause: failures[0],
    })
  }

  const stat = async (sha256: string): Promise<BlobStat | null> => {
    const record = await index.get(assertSha256Hex(sha256))
    return record === null ? null : { sha256, byteSize: record.byteSize, modifiedAtMs: record.modifiedAtMs }
  }

  const remove = async (sha256: string): Promise<boolean> => {
    const record = await index.get(assertSha256Hex(sha256))
    if (record === null) return false
    await pinning.unpin(record.cid)
    return index.remove(sha256)
  }

  async function* list(): AsyncGenerator<BlobStat, void, undefined> {
    for await (const record of index.list()) {
      yield { sha256: record.sha256, byteSize: record.byteSize, modifiedAtMs: record.modifiedAtMs }
    }
  }

  return { put, get, stat, delete: remove, list }
}
