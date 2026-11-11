import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Points the image store at a fresh temporary directory for the whole integration run.
 *
 * `config.ts` reads IMAGE_STORE_DIR once, when it is first imported, so this module has to be
 * imported before anything that imports `config` (`test/index.ts` imports it first). Without it
 * the tests would write into the repository's own `image-store/` directory.
 */
export const imageStoreRoot: string =
  process.env.IMAGE_STORE_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'gibs-integration-image-store-'))

process.env.IMAGE_STORE_DIR = imageStoreRoot

/** Removes the temporary directory. A directory the caller supplied through the environment is left alone. */
export const removeImageStoreRoot = (): void => {
  if (imageStoreRoot.startsWith(path.join(os.tmpdir(), 'gibs-integration-image-store-'))) {
    fs.rmSync(imageStoreRoot, { recursive: true, force: true })
  }
}
