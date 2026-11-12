/**
 * @module docs
 * Serves the repository's hand-written documentation over http.
 *
 * `/terms` answers from docs/terms.md. `/skills/{filename}` answers from the guides the
 * documentation build generates from the Starlight pages (packages/docs/dist/skills), which
 * is what `/llms.txt` links to. A guide that has not been built answers the ordinary 404.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { NextFunction, RequestHandler, Response } from 'express'
import config from '../../config'
import { DOCS_SITE_PATH } from './docs-site'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

/**
 * The repository's docs/ directory. Resolved from this file's own directory
 * rather than the working directory — the same approach STATIC_PATH in
 * app.ts uses — so it holds regardless of where the process is started
 * from. The server runs via `tsx src/bin/server.ts` in both development and
 * the production Docker image (see package.json's "server" script), so this
 * file's own directory is always packages/server/src/server, in source form,
 * in every environment that runs it.
 */
export const DOCS_PATH = path.join(currentDirectory, '..', '..', '..', '..', 'docs')

/**
 * A guide filename: a bare name ending in .md, no path separators and no
 * traversal segments. Matching this before touching the filesystem is what
 * keeps a path like `..%2f..%2fpackage.json` from ever reaching `path.join`.
 */
const SKILL_DOC_FILENAME = /^[\w-]+\.md$/

/**
 * The directory the documentation build writes the generated guides into
 * (`packages/docs/dist/skills`, see packages/docs/scripts/guides.ts). The site's pages are the only
 * copy of the guides' text; the build joins them into these files.
 */
export const GENERATED_SKILLS_PATH = path.join(DOCS_SITE_PATH, 'skills')

/**
 * Read a markdown file and send it as text/markdown, or hand off to `next()` so the request falls
 * through to the app's ordinary JSON 404 — the same response shape every other unmatched path
 * already answers with.
 */
const sendMarkdownFile = async (res: Response, next: NextFunction, filePath: string): Promise<void> => {
  const content = await fs.promises.readFile(filePath, 'utf8').catch(() => null)
  if (content === null) {
    next()
    return
  }
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.type('text/markdown').send(content)
}

/**
 * Build the handler for GET /skills/:filename. Only the generated guides are served; a guide the
 * documentation build has not produced falls through to the ordinary 404.
 *
 * @param options.generatedDirectory Where the documentation build writes the joined guides.
 */
export const createSkillDocHandler =
  (options: { generatedDirectory: string }): RequestHandler =>
  async (req, res, next) => {
    const filename = req.params.filename
    if (!SKILL_DOC_FILENAME.test(filename)) {
      next()
      return
    }
    await sendMarkdownFile(res, next, path.join(options.generatedDirectory, filename))
  }

/** GET /skills/:filename — one of the guides, from the documentation build. */
export const getSkillDoc: RequestHandler = createSkillDocHandler({ generatedDirectory: GENERATED_SKILLS_PATH })

/** GET /terms — the licence/attribution terms page every image response links to. */
export const getTerms: RequestHandler = async (_req, res, next) => {
  await sendMarkdownFile(res, next, path.join(DOCS_PATH, 'terms.md'))
}
