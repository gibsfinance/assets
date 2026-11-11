/**
 * The Google Cloud Storage adapter against the fake-gcs-server emulator in Docker. Skipped unless
 * IMAGE_STORE_EMULATORS=1. The emulator does not check sign-in, so the service-account token
 * exchange is covered by the unit tests against a fake that verifies the RS256 signature.
 */
import { afterAll, beforeAll } from 'vitest'
import { describeBlobStoreContract } from './__testing__/blob-store-contract'
import {
  EMULATORS_SKIP_REASON,
  emulatorsEnabled,
  pause,
  randomName,
  startEmulator,
  type RunningEmulator,
} from './__testing__/emulator'
import { createGcsBlobStore } from './gcs'

const BUCKET = 'image-store-test'
const IMAGE = process.env.IMAGE_STORE_FAKE_GCS_IMAGE ?? 'fsouza/fake-gcs-server:latest'

let emulator: RunningEmulator | undefined
const endpoint = () => `http://127.0.0.1:${(emulator as RunningEmulator).ports[4443]}`

beforeAll(async () => {
  if (!emulatorsEnabled) return
  emulator = await startEmulator({
    image: IMAGE,
    containerPorts: [4443],
    command: ['-scheme', 'http', '-port', '4443', '-backend', 'memory'],
    isReady: async (ports) => (await fetch(`http://127.0.0.1:${ports[4443]}/storage/v1/b`)).ok,
  })
  const created = await fetch(`${endpoint()}/storage/v1/b?project=test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: BUCKET }),
  })
  if (!created.ok) throw new Error(`could not create the bucket: ${created.status}`)
}, 180_000)

afterAll(async () => {
  await emulator?.stop()
})

describeBlobStoreContract(
  'Google Cloud Storage against fake-gcs-server',
  async () => ({
    store: createGcsBlobStore({ bucket: BUCKET, endpoint: endpoint(), keyPrefix: `${randomName()}/`, pageSize: 3 }),
    clock: Date.now,
    advanceClock: () => pause(1100),
  }),
  {
    skipReason: emulatorsEnabled ? undefined : EMULATORS_SKIP_REASON,
    timeoutMs: 60_000,
    // Measured: after a metadata PATCH, this emulator reports the same `updated` time. Google's
    // service moves it ("the modification time of the object metadata"), and `images gc` relies on that.
    renewalLimitation: 'fake-gcs-server does not move "updated" on a metadata PATCH',
  },
)
