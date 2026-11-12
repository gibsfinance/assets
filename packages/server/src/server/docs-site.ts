/**
 * @module docs-site
 * Serves the built documentation site (packages/docs) from this server, chosen by host name.
 *
 * One process answers for two kinds of host. A request whose host name is in `DOCS_HOSTNAMES`
 * gets the static site and nothing else: the API routes never answer there, and a miss is the
 * site's own 404 page. Every other host reaches the ordinary application, which never serves
 * the site. With the setting empty, the whole feature is off and this handler passes every
 * request on.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import type { RequestHandler } from 'express'
import type { ServerResponse } from 'http'
import { IMMUTABLE_CACHE_CONTROL, REVALIDATE_CACHE_CONTROL } from './static-headers'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

/**
 * The built documentation site (`yarn workspace docs build`). Resolved from this file's own
 * directory, like the interface's path in app.ts, so it holds wherever the process starts.
 */
export const DOCS_SITE_PATH = path.join(currentDirectory, '..', '..', '..', 'docs', 'dist')

/**
 * Whether a request's host name belongs to the documentation site.
 *
 * @param hostname The request's host name, without a port (`req.hostname`).
 * @param docsHostnames The configured names, already lower case (see `readHostnames`).
 */
export const isDocsHost = (hostname: string, docsHostnames: readonly string[]): boolean =>
  docsHostnames.includes(hostname.toLowerCase())

/**
 * Build the `setHeaders` hook for `express.static` over the documentation site.
 *
 * Astro writes every file under `_astro/` with a content hash in its name, so a given address
 * always returns the same bytes and may be kept for a year. A page names those hashed files, so
 * it must be asked about on every visit: HTML gets `no-cache`. Every other file (the search
 * index, the sitemap, the generated guides) keeps the static handler's default.
 *
 * @param root Absolute path of the directory handed to `express.static`.
 */
export const docsCacheHeaders =
  (root: string) =>
  (res: ServerResponse, filePath: string): void => {
    const relative = path.relative(root, filePath)
    if (relative.startsWith(`_astro${path.sep}`)) {
      res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL)
      return
    }
    if (path.extname(relative) === '.html') res.setHeader('Cache-Control', REVALIDATE_CACHE_CONTROL)
  }

/**
 * Answer 404 with the site's own not-found page, or a short text when the site has not been built.
 */
const sendNotFound = async (res: express.Response, root: string): Promise<void> => {
  const page = await fs.promises.readFile(path.join(root, '404.html'), 'utf8').catch(() => null)
  res.status(404).set('cache-control', REVALIDATE_CACHE_CONTROL)
  if (page === null) {
    res.type('text/plain').send('Not found')
    return
  }
  res.type('text/html').send(page)
}

/**
 * Build the handler that serves the documentation site on the configured host names.
 *
 * @param options.hostnames Host names that get the site. Empty turns the feature off.
 * @param options.root Directory holding the built site.
 * @returns A handler that passes a request on untouched when its host is not a docs host, and
 *   otherwise answers it completely: a file from the site, or the site's 404 page.
 */
export const createDocsSiteHandler = (options: { hostnames: readonly string[]; root: string }): RequestHandler => {
  const serveFiles = express.static(options.root, { setHeaders: docsCacheHeaders(options.root) })
  return (req, res, next) => {
    if (!isDocsHost(req.hostname, options.hostnames)) {
      next()
      return
    }
    serveFiles(req, res, (error?: unknown) => {
      if (error) {
        next(error)
        return
      }
      void sendNotFound(res, options.root).catch(next)
    })
  }
}
