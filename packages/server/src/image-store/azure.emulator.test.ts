/**
 * The Azure adapter against the Azurite emulator in Docker. Skipped unless IMAGE_STORE_EMULATORS=1.
 * Azurite checks Shared Key signatures, so this is what proves the signer on the wire.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeBlobStoreContract } from './__testing__/blob-store-contract'
import {
  EMULATORS_SKIP_REASON,
  emulatorsEnabled,
  pause,
  randomName,
  startEmulator,
  type RunningEmulator,
} from './__testing__/emulator'
import { AZURE_API_VERSION, createAzureBlobStore, signSharedKey } from './azure'
import { hashBytes } from './hash'

/** The account name and key Azurite documents for its built-in development account. */
const ACCOUNT = 'devstoreaccount1'
const ACCOUNT_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='
const CONTAINER = 'image-store-test'
const IMAGE = process.env.IMAGE_STORE_AZURITE_IMAGE ?? 'mcr.microsoft.com/azure-storage/azurite:latest'

let emulator: RunningEmulator | undefined
const endpoint = () => `http://127.0.0.1:${(emulator as RunningEmulator).ports[10000]}/${ACCOUNT}`

beforeAll(async () => {
  if (!emulatorsEnabled) return
  emulator = await startEmulator({
    image: IMAGE,
    containerPorts: [10000],
    command: ['azurite-blob', '--blobHost', '0.0.0.0', '--skipApiVersionCheck', '--inMemoryPersistence'],
    isReady: async (ports) => {
      await fetch(`http://127.0.0.1:${ports[10000]}/${ACCOUNT}`)
      return true
    },
  })
  const url = new URL(`${endpoint()}/${CONTAINER}?restype=container`)
  const headers: Record<string, string> = { 'x-ms-date': new Date().toUTCString(), 'x-ms-version': AZURE_API_VERSION }
  headers.authorization = signSharedKey(
    { method: 'PUT', url, headers, contentLength: 0, accountName: ACCOUNT },
    ACCOUNT_KEY,
  )
  const created = await fetch(url, { method: 'PUT', headers })
  if (!created.ok) throw new Error(`could not create the container: ${created.status}`)
}, 180_000)

afterAll(async () => {
  await emulator?.stop()
})

const storeWithPrefix = (keyPrefix: string, accountKey = ACCOUNT_KEY) =>
  createAzureBlobStore({
    accountName: ACCOUNT,
    containerName: CONTAINER,
    accountKey,
    endpoint: endpoint(),
    keyPrefix,
    pageSize: 3,
    retries: 0,
  })

describeBlobStoreContract(
  'Azure Blob Storage against Azurite',
  async () => ({
    store: storeWithPrefix(`${randomName()}/`),
    clock: Date.now,
    advanceClock: () => pause(1100),
  }),
  { skipReason: emulatorsEnabled ? undefined : EMULATORS_SKIP_REASON, timeoutMs: 60_000 },
)

describe.skipIf(!emulatorsEnabled)('Azure Blob Storage against Azurite: more than the contract', () => {
  it('rejects a request signed with the wrong key, so the signature really is checked', async () => {
    const wrong = storeWithPrefix('x/', Buffer.from('not the key').toString('base64'))

    await expect(wrong.stat(hashBytes(Buffer.from('x')))).rejects.toMatchObject({ status: 403 })
  })
})
