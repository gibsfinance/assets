/**
 * Tests for the /list route table: each path pattern reaches its documented
 * handler. Handlers are mocked with marker responses so a passing assertion
 * here can only mean this specific route pattern dispatched to that specific
 * handler — not that some other route happened to also 200.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('./handlers', () => ({
  merged: vi.fn((_req: any, res: any) => res.json({ marker: 'merged' })),
  tokensByChain: vi.fn((_req: any, res: any) => res.json({ marker: 'tokensByChain' })),
  versioned: vi.fn((_req: any, res: any) => res.json({ marker: 'versioned' })),
  providerKeyed: vi.fn((_req: any, res: any) => res.json({ marker: 'providerKeyed' })),
  all: vi.fn((_req: any, res: any) => res.json({ marker: 'all' })),
}))

describe('/list router wiring', () => {
  let app: express.Express

  beforeAll(async () => {
    const { router } = await import('./index')
    app = express()
    app.use('/list', router)
  })

  it('routes /list/merged/:order to merged', async () => {
    const res = await request(app).get('/list/merged/default')
    expect(res.body).toEqual({ marker: 'merged' })
  })

  it('routes /list/tokens/:chainId to tokensByChain', async () => {
    const res = await request(app).get('/list/tokens/369')
    expect(res.body).toEqual({ marker: 'tokensByChain' })
  })

  it('routes /list/:providerKey/:listKey/:version to versioned', async () => {
    const res = await request(app).get('/list/pulsex/extended/1.0.0')
    expect(res.body).toEqual({ marker: 'versioned' })
  })

  it('routes /list/:providerKey/:listKey to providerKeyed', async () => {
    const res = await request(app).get('/list/pulsex/extended')
    expect(res.body).toEqual({ marker: 'providerKeyed' })
  })

  it('routes /list/:providerKey (no listKey) to providerKeyed', async () => {
    const res = await request(app).get('/list/pulsex')
    expect(res.body).toEqual({ marker: 'providerKeyed' })
  })

  it('routes /list/ (root) to all', async () => {
    const res = await request(app).get('/list/')
    expect(res.body).toEqual({ marker: 'all' })
  })
})
