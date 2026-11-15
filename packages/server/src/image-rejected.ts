/**
 * @module image-rejected
 * The one kind of error that means "this image cannot be made safe to store". `insertImage` catches
 * it, logs it and stores nothing, and the submit route answers 400.
 */

/** An image that cannot be cleaned, so it is refused instead of stored as it came. */
export class ImageRejectedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ImageRejectedError'
  }
}
