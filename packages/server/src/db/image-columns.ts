/**
 * @module image-columns
 * How a query reads an `image` row without pulling bytes it does not need.
 *
 * A row is in one of three states. Before `images export` has run it holds its bytes in
 * `content` and has no digest. After, it has a digest (`content_sha256`) and a length, and the
 * bytes are in the image store, with or without a copy still in `content`. Once the setting
 * `IMAGE_BYTES_IN_DATABASE` is off, a new row has a digest and a NULL `content`. A reader
 * therefore takes `content` from the row only when there is no digest, and otherwise reads
 * the file (see `loadImageBytes`). Selecting `content` unconditionally would make Postgres
 * send, and node-postgres decode, a hexadecimal copy of every image that a file already holds.
 */
import { sql as dsql, type SQL } from 'drizzle-orm'
import * as s from './schema'

/**
 * The bytes a row still carries that the store does not hold: `content` when the row has no
 * digest, NULL otherwise. Link-only rows have no digest and an empty `content`, which this
 * returns as it is.
 */
export const unexportedBytesSql: SQL<Buffer | null> = dsql<Buffer | null>`CASE WHEN ${s.image.contentSha256} IS NULL THEN ${s.image.content} END`

/**
 * Every `image` column, with `content` narrowed by {@link unexportedBytesSql}. Use it as the
 * selection of a query on `image` that has to return whole rows.
 */
export const imageColumnsWithoutStoredBytes = {
  imageHash: s.image.imageHash,
  content: unexportedBytesSql,
  contentSha256: s.image.contentSha256,
  byteSize: s.image.byteSize,
  uri: s.image.uri,
  ext: s.image.ext,
  mode: s.image.mode,
  createdAt: s.image.createdAt,
}
