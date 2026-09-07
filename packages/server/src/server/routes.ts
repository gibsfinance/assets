import { Router } from 'express'
import { router as imageRouter } from './image'
import { router as imageSubmitRouter } from './image-submit'
import { router as listRouter } from './list'
import { router as networksRouter } from './networks'
import { router as statsRouter } from './stats'
import { router as githubRouter } from './github'
import { router as submissionsRouter } from './submissions'
import * as sprite from './image/sprite'
import { nextOnError } from './utils'
import { openapi } from './openapi'
import { LLMS_TXT } from './llms-txt'
import { getSkillDoc, getTerms } from './docs'
import config from '../../config'

export const router = Router() as Router

// Health check handled in app.ts (before router) — removed duplicate here

// The OpenAPI definition — the docs page renders its endpoint sections from this
router.get('/openapi.json', (_req, res) => {
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`).json(openapi)
})

// A machine-readable index of the routes below, following the llmstxt.org convention.
router.get('/llms.txt', (_req, res) => {
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`).type('text/plain').send(LLMS_TXT)
})

// The licence/attribution terms page every image response links back to.
router.get('/terms', nextOnError(getTerms))

// The hand-written guides under docs/skills/, published as text/markdown.
router.get('/skills/:filename', nextOnError(getSkillDoc))

// /docs and /studio are real pages in the interface, but it uses a hash router
// (see packages/ui/src/App.tsx) — a URL fragment never reaches the server, so
// these plain paths used to 404 for anyone who typed or linked them directly.
router.get('/docs', (_req, res) => res.redirect(302, '/#/docs'))
router.get('/studio', (_req, res) => res.redirect(302, '/#/studio'))

// gib.show/image
router.use('/image', imageRouter)

// gib.show/sprite
router.get('/sprite/:providerKey/:listKey/sheet', nextOnError(sprite.sheet))
router.get('/sprite/:providerKey/:listKey', nextOnError(sprite.manifest))

// gib.show/list
router.use('/list', listRouter)

router.use('/networks', networksRouter)

// gib.show/stats
router.use('/stats', statsRouter)

// GitHub OAuth token exchange proxy
router.use('/api/github', githubRouter)

// List submission registry
router.use('/api/lists', submissionsRouter)

// Image submission endpoint
router.use('/api/images', imageSubmitRouter)
