/**
 * @module image/sanitize-job
 * One sanitizing job for the bytes of a remote image, as the worker thread runs it (see
 * `bin/sanitize-worker.ts`). The request and the reply cross a thread boundary, so both are plain
 * data: the bytes travel as a `Uint8Array` whose buffer is transferred, and a refusal travels as its
 * message.
 */
import { sanitizeImage } from '../../sanitize'

/** The bytes to sanitize and the extension they were fetched under. */
export interface SanitizeJobRequest {
  bytes: Uint8Array
  ext: string
}

/** The sanitized bytes, or the message of the refusal. */
export type SanitizeJobReply = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; message: string }

/**
 * A copy of `bytes` in an `ArrayBuffer` of its own. A buffer that is transferred to another thread
 * moves whole, so a view into a larger pool would move every byte of that pool with it.
 *
 * @param bytes The bytes to copy.
 * @returns A new array holding the same bytes, owning its buffer.
 */
export function copyToOwnBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  copy.set(bytes)
  return copy
}

/**
 * Sanitize one job. A refusal (the sanitizer throws) is an answer, not a failure of the job: it comes
 * back as `{ ok: false }` with the message.
 *
 * @param request The bytes and extension to sanitize.
 * @returns The sanitized bytes, or the refusal.
 */
export async function runSanitizeJob({ bytes, ext }: SanitizeJobRequest): Promise<SanitizeJobReply> {
  try {
    const sanitized = await sanitizeImage(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), ext)
    return { ok: true, bytes: copyToOwnBuffer(sanitized) }
  } catch (error) {
    // `sanitizeImage` throws only errors (see `ImageRejectedError`), so the message is always there.
    return { ok: false, message: (error as Error).message }
  }
}
