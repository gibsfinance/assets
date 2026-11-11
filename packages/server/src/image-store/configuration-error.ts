/**
 * The image store's configuration is missing or wrong. The message names the setting and what
 * was expected, so an operator can fix it from the start-up log alone. It never contains a
 * secret's value.
 */
export class ImageStoreConfigurationError extends Error {
  /** @param message What is wrong and how to fix it. */
  constructor(message: string) {
    super(message)
    this.name = 'ImageStoreConfigurationError'
  }
}
