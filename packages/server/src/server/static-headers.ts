import path from 'path'
import type { ServerResponse } from 'http'

/** Hashed build output never changes under its name, so a browser may keep it for a year. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** The entry document names the hashed files, so every visit must ask whether it changed. */
export const REVALIDATE_CACHE_CONTROL = 'no-cache'

/**
 * Files whose name never changes while their content does. `index.html` names the
 * hashed build files. `sw.js` is the service worker: browsers find it by its address,
 * so it cannot be hashed, and a copy cached for a year would keep a retired worker
 * (or the kill switch that replaces it) from ever reaching a returning visitor.
 */
const REVALIDATED_FILES = new Set(['index.html', 'sw.js'])

/**
 * Build the `setHeaders` hook for `express.static`.
 *
 * Vite writes every file under `assets/` with a content hash in its name, so a given
 * URL always returns the same bytes and can be cached without asking again. Without
 * this, the content delivery network revalidated each of those files on every repeat
 * visit.
 *
 * `index.html` and `sw.js` are the opposite case: their names never change while their content does,
 * because it points at the current hashed files. It must never be marked immutable, or
 * a deploy would not take effect until the old copy expired. It gets `no-cache`
 * explicitly, which means "store, but revalidate before use", rather than relying on
 * the static handler's default. Every other file keeps that default.
 *
 * @param root Absolute path of the directory handed to `express.static`.
 */
export const staticCacheHeaders =
  (root: string) =>
  (res: ServerResponse, filePath: string): void => {
    const relative = path.relative(root, filePath)
    if (REVALIDATED_FILES.has(relative)) {
      res.setHeader('Cache-Control', REVALIDATE_CACHE_CONTROL)
      return
    }
    if (relative.startsWith(`assets${path.sep}`)) res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL)
  }
