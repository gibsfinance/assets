/**
 * @module image-variant-rows
 * The statement that removes every resized copy (`image_variant` row) of one image.
 *
 * A resized copy is drawn from one set of image bytes. When the bytes of the image change, the copies drawn from the
 * old bytes must go in the same transaction, so none is served again. Both the collector's upsert and the image
 * resanitize operation use this statement; neither writes its own.
 */
import { eq } from 'drizzle-orm'
import type { DrizzleTx } from './drizzle'
import * as s from './schema'

/** The database calls that remove variants: a transaction, which the callers always run these in. */
type VariantDeleter = Pick<DrizzleTx, 'delete'>

/**
 * Delete every resized copy of one image. The statement is returned without being awaited, so a caller can read the
 * rows it removed (`.returning(...)`) or run it inside the transaction it already holds.
 *
 * @param deleter The transaction the delete runs in.
 * @param imageHash The `image_hash` whose resized copies go.
 */
export const deleteVariantsOfImage = (deleter: VariantDeleter, imageHash: string) =>
  deleter.delete(s.imageVariant).where(eq(s.imageVariant.imageHash, imageHash))
