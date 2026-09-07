/**
 * Tests for the top-level route table: every sub-router is mounted at its
 * documented prefix, in front of the correct handler, and the two directly
 * registered endpoints (openapi, sprite) call the expected functions.
 *
 * Every dependency below is mocked with a marker route/response so a passing
 * assertion here can only mean the wiring in routes.ts routed the request to
 * that specific module — not that some other router happened to also 200.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { Router } from 'express'
import express from 'express'
import request from 'supertest'

function markerRouter(marker: string) {
  const router = Router()
  router.get('/', (_req, res) => res.json({ marker }))
  router.get('/probe', (_req, res) => res.json({ marker }))
  return router
}

vi.mock('./image', () => ({ router: markerRouter('image') }))
vi.mock('./image-submit', () => ({ router: markerRouter('image-submit') }))
vi.mock('./list', () => ({ router: markerRouter('list') }))
vi.mock('./networks', () => ({ router: markerRouter('networks') }))
vi.mock('./stats', () => ({ router: markerRouter('stats') }))
vi.mock('./github', () => ({ router: markerRouter('github') }))
vi.mock('./submissions', () => ({ router: markerRouter('submissions') }))
vi.mock('./image/sprite', () => ({
  sheet: vi.fn((_req, res) => res.json({ marker: 'sprite-sheet' })),
  manifest: vi.fn((_req, res) => res.json({ marker: 'sprite-manifest' })),
}))
vi.mock('./openapi', () => ({ openapi: { marker: 'openapi-document' } }))
vi.mock('./llms-txt', () => ({ LLMS_TXT: 'LLMS_TXT_MARKER' }))
vi.mock('./docs', () => ({
  getSkillDoc: vi.fn((_req, res) => res.json({ marker: 'skill-doc' })),
  getTerms: vi.fn((_req, res) => res.json({ marker: 'terms' })),
}))
vi.mock('../../config', () => ({ default: { cacheSeconds: 3600 } }))

describe('router wiring', () => {
  let app: express.Express

  beforeAll(async () => {
    const { router } = await import('./routes')
    app = express()
    app.use(router)
  })

  it('serves the openapi document with a public cache-control header', async () => {
    const res = await request(app).get('/openapi.json')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ marker: 'openapi-document' })
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
  })

  it('serves /llms.txt as plain text with a public cache-control header', async () => {
    const res = await request(app).get('/llms.txt')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
    expect(res.text).toBe('LLMS_TXT_MARKER')
  })

  it('routes /terms to the terms handler', async () => {
    const res = await request(app).get('/terms')
    expect(res.body).toEqual({ marker: 'terms' })
  })

  it('routes /skills/:filename to the skill-doc handler', async () => {
    const res = await request(app).get('/skills/api-reference.md')
    expect(res.body).toEqual({ marker: 'skill-doc' })
  })

  it('redirects /docs to the hash-routed documentation page', async () => {
    const res = await request(app).get('/docs')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/#/docs')
  })

  it('redirects /studio to the hash-routed studio', async () => {
    const res = await request(app).get('/studio')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/#/studio')
  })

  it('mounts the image router at /image', async () => {
    const res = await request(app).get('/image/probe')
    expect(res.body).toEqual({ marker: 'image' })
  })

  it('registers the sprite sheet handler at /sprite/:providerKey/:listKey/sheet', async () => {
    const res = await request(app).get('/sprite/pulsex/extended/sheet')
    expect(res.body).toEqual({ marker: 'sprite-sheet' })
  })

  it('registers the sprite manifest handler at /sprite/:providerKey/:listKey', async () => {
    const res = await request(app).get('/sprite/pulsex/extended')
    expect(res.body).toEqual({ marker: 'sprite-manifest' })
  })

  it('the sheet route is checked before the shorter manifest route (order matters for :listKey matching)', async () => {
    // If manifest were registered first, "sheet" would be captured as :listKey
    // instead of reaching the dedicated sheet route.
    const res = await request(app).get('/sprite/pulsex/extended/sheet')
    expect(res.body.marker).toBe('sprite-sheet')
  })

  it('mounts the list router at /list', async () => {
    const res = await request(app).get('/list/probe')
    expect(res.body).toEqual({ marker: 'list' })
  })

  it('mounts the networks router at /networks', async () => {
    const res = await request(app).get('/networks/probe')
    expect(res.body).toEqual({ marker: 'networks' })
  })

  it('mounts the stats router at /stats', async () => {
    const res = await request(app).get('/stats/probe')
    expect(res.body).toEqual({ marker: 'stats' })
  })

  it('mounts the github router at /api/github', async () => {
    const res = await request(app).get('/api/github/probe')
    expect(res.body).toEqual({ marker: 'github' })
  })

  it('mounts the submissions router at /api/lists', async () => {
    const res = await request(app).get('/api/lists/probe')
    expect(res.body).toEqual({ marker: 'submissions' })
  })

  it('mounts the image-submit router at /api/images', async () => {
    const res = await request(app).get('/api/images/probe')
    expect(res.body).toEqual({ marker: 'image-submit' })
  })
})
