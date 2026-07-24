/**
 * Tests for the /image route table: each path pattern reaches its documented
 * handler, and — critically — the generic `/:chainId/:address` and
 * `/:chainId` best-guess fallback are ordered so a real address route never
 * gets swallowed by the network-icon best-guess catch-all.
 *
 * Handlers are mocked with marker responses so a passing assertion here can
 * only mean this specific route pattern dispatched to that specific handler.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('./handlers', () => ({
  getImageByHash: vi.fn((_req: any, res: any) => res.json({ marker: 'getImageByHash' })),
  getImageAndFallback: vi.fn((_req: any, res: any) => res.json({ marker: 'getImageAndFallback' })),
  getImage: vi.fn((withOrder: boolean) => (_req: any, res: any) => res.json({ marker: 'getImage', withOrder })),
  bestGuessNetworkImageFromOnOnChainInfo: vi.fn((_req: any, res: any) =>
    res.json({ marker: 'bestGuessNetworkImageFromOnOnChainInfo' }),
  ),
  tryMultiple: vi.fn((_req: any, res: any) => res.json({ marker: 'tryMultiple' })),
}))

describe('/image router wiring', () => {
  let app: express.Express

  beforeAll(async () => {
    const { router } = await import('./index')
    app = express()
    app.use('/image', router)
  })

  it('routes /image/direct/:imageHash to getImageByHash', async () => {
    const res = await request(app).get('/image/direct/abc123')
    expect(res.body).toEqual({ marker: 'getImageByHash' })
  })

  it('routes /image/fallback/:order/:chainId/:address to getImageAndFallback', async () => {
    const res = await request(app).get('/image/fallback/default/369/0xabc')
    expect(res.body).toEqual({ marker: 'getImageAndFallback' })
  })

  it('routes /image/:order/:chainId/:address to getImage(true) — order-aware lookup', async () => {
    const res = await request(app).get('/image/default/369/0xabc')
    expect(res.body).toEqual({ marker: 'getImage', withOrder: true })
  })

  it('routes /image/:chainId/:address to getImage(false) — no order segment', async () => {
    const res = await request(app).get('/image/369/0xabc')
    expect(res.body).toEqual({ marker: 'getImage', withOrder: false })
  })

  it('falls back to the best-guess network handler for a bare /image/:chainId', async () => {
    const res = await request(app).get('/image/369')
    expect(res.body).toEqual({ marker: 'bestGuessNetworkImageFromOnOnChainInfo' })
  })

  it('falls back to tryMultiple at the router root', async () => {
    const res = await request(app).get('/image/')
    expect(res.body).toEqual({ marker: 'tryMultiple' })
  })
})
