/**
 * The S3 adapter against a real MinIO server in Docker. Skipped unless IMAGE_STORE_EMULATORS=1.
 * MinIO checks the Signature Version 4 signature, so this is what proves the signer on the wire.
 */
import * as fileSystem from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
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
import { copyBlobs } from './copy'
import { createLocalBlobStore } from './local'
import { createMirroredBlobStore } from './composite'
import { hashBytes } from './hash'
import { EMPTY_PAYLOAD_SHA256, signRequestV4 } from './sigv4'
import { createS3BlobStore } from './s3'

const CREDENTIALS = { accessKeyId: 'testaccesskey', secretAccessKey: 'testsecretkey123' }
const BUCKET = 'image-store-test'
const IMAGE = process.env.IMAGE_STORE_MINIO_IMAGE ?? 'cgr.dev/chainguard/minio:latest'

let emulator: RunningEmulator | undefined
const endpoint = () => `http://127.0.0.1:${(emulator as RunningEmulator).ports[9000]}`

beforeAll(async () => {
  if (!emulatorsEnabled) return
  emulator = await startEmulator({
    image: IMAGE,
    containerPorts: [9000],
    environment: { MINIO_ROOT_USER: CREDENTIALS.accessKeyId, MINIO_ROOT_PASSWORD: CREDENTIALS.secretAccessKey },
    command: ['server', '/data'],
    isReady: async (ports) => (await fetch(`http://127.0.0.1:${ports[9000]}/minio/health/live`)).ok,
  })
  const url = new URL(`${endpoint()}/${BUCKET}`)
  const headers = signRequestV4({
    method: 'PUT',
    url,
    payloadSha256: EMPTY_PAYLOAD_SHA256,
    region: 'us-east-1',
    credentials: CREDENTIALS,
    date: new Date(),
  })
  const created = await fetch(url, { method: 'PUT', headers })
  if (!created.ok) throw new Error(`could not create the bucket: ${created.status}`)
}, 180_000)

afterAll(async () => {
  await emulator?.stop()
})

const storeWithPrefix = (keyPrefix: string, pageSize = 3) =>
  createS3BlobStore({
    location: { endpoint: endpoint(), region: 'us-east-1', addressing: 'path' },
    bucket: BUCKET,
    credentials: CREDENTIALS,
    keyPrefix,
    pageSize,
  })

describeBlobStoreContract(
  'S3 against MinIO',
  async () => ({
    store: storeWithPrefix(`${randomName()}/`),
    clock: Date.now,
    // MinIO stamps objects to the millisecond, but a pause longer than a second is safe on any S3.
    advanceClock: () => pause(1100),
  }),
  { skipReason: emulatorsEnabled ? undefined : EMULATORS_SKIP_REASON, timeoutMs: 60_000 },
)

describe.skipIf(!emulatorsEnabled)('S3 against MinIO: more than the contract', () => {
  it('rejects a request signed with the wrong secret, so the signature really is checked', async () => {
    const wrong = createS3BlobStore({
      location: { endpoint: endpoint(), region: 'us-east-1', addressing: 'path' },
      bucket: BUCKET,
      credentials: { ...CREDENTIALS, secretAccessKey: 'not the secret' },
      retries: 0,
    })

    await expect(wrong.stat(hashBytes(Buffer.from('x')))).rejects.toMatchObject({ status: 403 })
  })

  it('copies a local store into the bucket and back, with every blob verified', async () => {
    const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'minio-copy-'))
    const local = createLocalBlobStore({ root: directory })
    const remote = storeWithPrefix(`${randomName()}/`)
    for (const text of ['one', 'two', 'three', 'four']) await local.put(Buffer.from(text))

    expect(await copyBlobs({ from: local, to: remote })).toMatchObject({ scanned: 4, copied: 4, ok: true })
    expect(await copyBlobs({ from: local, to: remote })).toMatchObject({ copied: 0, skippedExisting: 4 })

    const back = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'minio-copy-back-'))
    expect(await copyBlobs({ from: remote, to: createLocalBlobStore({ root: back }) })).toMatchObject({
      copied: 4,
      ok: true,
    })
    await fileSystem.rm(directory, { recursive: true, force: true })
    await fileSystem.rm(back, { recursive: true, force: true })
  })

  it('works as one member of a mirror', async () => {
    const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'minio-mirror-'))
    const local = createLocalBlobStore({ root: directory })
    const remote = storeWithPrefix(`${randomName()}/`)
    const mirror = createMirroredBlobStore({ stores: [local, remote] })

    const { sha256 } = await mirror.put(Buffer.from('in both'))

    expect(await remote.get(sha256)).toEqual(Buffer.from('in both'))
    expect(await local.get(sha256)).toEqual(Buffer.from('in both'))
    await fileSystem.rm(directory, { recursive: true, force: true })
  })
})
