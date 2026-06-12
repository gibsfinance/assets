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
import config from '../../config'

export const router = Router() as Router

// Health check handled in app.ts (before router) — removed duplicate here

// The OpenAPI definition — the docs page renders its endpoint sections from this
router.get('/openapi.json', (_req, res) => {
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`).json(openapi)
})

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
