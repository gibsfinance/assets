import * as fileSystem from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describeBlobStoreContract } from './__testing__/blob-store-contract'
import { createLocalBlobStore } from './local'

describeBlobStoreContract('local directory', async () => {
  const root = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'image-store-contract-'))
  return {
    store: createLocalBlobStore({ root }),
    clock: Date.now,
    advanceClock: () => new Promise((resolve) => setTimeout(resolve, 25)),
    cleanup: () => fileSystem.rm(root, { recursive: true, force: true }),
  }
})
