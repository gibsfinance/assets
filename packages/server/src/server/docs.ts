/**
 * @module docs
 * Serves the repository's hand-written documentation over http.
 *
 * docs/terms.md and docs/skills/*.md used to be repo-only files nothing pointed
 * at: the interface's own docs page lived behind a hash route (`/#/docs`),
 * which a server never receives, so an external caller had no way to reach
 * them short of reading source in the repository. This module is what lets
 * `/terms` and `/skills/{filename}` answer directly, and what `/llms.txt`
 * links to.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { NextFunction, RequestHandler, Response } from 'express'
import config from '../../config'

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

export const SKILLS_DOCS_PATH = path.join(DOCS_PATH, 'skills')

/**
 * A guide filename: a bare name ending in .md, no path separators and no
 * traversal segments. Matching this before touching the filesystem is what
 * keeps a path like `..%2f..%2fpackage.json` from ever reaching `path.join`.
 */
const SKILL_DOC_FILENAME = /^[\w-]+\.md$/

/**
 * Read a markdown file and send it as text/markdown, or hand off to `next()`
 * so the request falls through to the app's ordinary JSON 404 — the same
 * response shape every other unmatched path already answers with.
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

/** GET /skills/:filename — one of the guides under docs/skills/. */
export const getSkillDoc: RequestHandler = async (req, res, next) => {
  const filename = req.params.filename
  if (!SKILL_DOC_FILENAME.test(filename)) {
    next()
    return
  }
  await sendMarkdownFile(res, next, path.join(SKILLS_DOCS_PATH, filename))
}

/** GET /terms — the licence/attribution terms page every image response links to. */
export const getTerms: RequestHandler = async (_req, res, next) => {
  await sendMarkdownFile(res, next, path.join(DOCS_PATH, 'terms.md'))
}
