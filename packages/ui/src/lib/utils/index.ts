import { root } from '../config'

/**
 * Resolves a server path against the configured base, which is fixed at build time.
 *
 * This module used to carry a lazily-assigned `apiBase` alongside an initializer that
 * set it. Nothing ever called the initializer, so the override was always null and
 * every caller already read `root` — and the initializer assigned `root` anyway, so
 * calling it would not have changed an answer either. Both are gone; there is one
 * source for the base and it is this import.
 *
 * @param path Server-relative path, leading slash included (for example `/list/search`).
 * @returns The absolute request URL.
 */
export function getApiUrl(path: string): string {
  return `${root}${path}`
}
