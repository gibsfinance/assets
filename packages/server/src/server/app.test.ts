/**
 * Tests for the top-level express app: readiness gating, middleware wiring
 * order, and the final error funnel.
 *
 * Why these matter: `/health` is the deploy probe — serving 200 before
 * migrations/warm-up finish would tell an orchestrator the instance is ready
 * when it is not. The router and error middleware are mocked here so this
 * file only asserts what app.ts itself wires, not the sub-routers' behavior
 * (covered by their own test files).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { Router } from 'express'
import createError from 'http-errors'
import request from 'supertest'

vi.mock('./routes', () => {
  const router = Router()
  router.get('/ping', (_req, res) => res.json({ pong: true }))
  router.get('/boom-client', (_req, _res, next) => next(createError.NotFound('not found here')))
  router.get('/boom-server', (_req, _res, next) => next(new Error('raw internal detail')))
  router.post('/echo', (req, res) => res.json({ body: req.body }))
  return { router }
})

describe('app', () => {
  let app: import('express').Express
  let setReady: () => void

  beforeAll(async () => {
    // Imported once, after the mock above is registered, since app.ts wires
    // the router and the health flag at module load.
    const mod = await import('./app')
    app = mod.app
    setReady = mod.setReady
  })

  it('serves 503 on /health before setReady() has been called', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'starting' })
  })

  it('serves 200 on /health once setReady() flips the flag', async () => {
    setReady()
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('mounts the application router beneath the health check', async () => {
    const res = await request(app).get('/ping')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ pong: true })
  })

  it('applies cors() — cross-origin requests get an Access-Control-Allow-Origin header', async () => {
    const res = await request(app).get('/ping').set('Origin', 'https://example.com')
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  // Attribution headers are only readable from browser JavaScript when the
  // server lists them in Access-Control-Expose-Headers — the default cors()
  // options expose nothing, which is why a browser client could not read
  // x-uri (or any of the newer x-* attribution headers) at all before this.
  it('exposes every attribution header for cross-origin browser reads', async () => {
    const res = await request(app).get('/ping').set('Origin', 'https://example.com')
    const exposed = res.headers['access-control-expose-headers']
    expect(exposed).toContain('link')
    expect(exposed).toContain('x-source-uri')
    expect(exposed).toContain('x-provider')
    expect(exposed).toContain('x-provider-name')
    expect(exposed).toContain('x-license')
    expect(exposed).toContain('x-license-url')
    expect(exposed).toContain('x-attribution')
    expect(exposed).toContain('x-uri')
  })

  // x-resolved-chain names a chain-resolution outcome, not an attribution
  // fact, but a browser script reading it cross-origin needs the identical
  // Access-Control-Expose-Headers treatment as the attribution headers above.
  it('exposes x-resolved-chain for cross-origin browser reads', async () => {
    const res = await request(app).get('/ping').set('Origin', 'https://example.com')
    const exposed = res.headers['access-control-expose-headers']
    expect(exposed).toContain('x-resolved-chain')
  })

  it('applies the urlencoded and json body parsers ahead of the router', async () => {
    const res = await request(app).post('/echo').send({ hello: 'world' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ body: { hello: 'world' } })
  })

  it('routes an intentional client error through errorMiddleware with its message intact', async () => {
    const res = await request(app).get('/boom-client')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not found here' })
  })

  it('sanitizes an unexpected error to a generic 500 via errorMiddleware', async () => {
    const res = await request(app).get('/boom-server')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'internal server error' })
    expect(JSON.stringify(res.body)).not.toContain('raw internal detail')
  })
})
