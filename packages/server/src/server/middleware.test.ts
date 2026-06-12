/**
 * Tests for the app-level error funnel and JSON body limit.
 *
 * Why these matter: the error middleware is the single place that keeps
 * database internals (raw SQL text and parameters from Drizzle errors) from
 * reaching clients, while still letting intentional http-errors 4xx through.
 * The JSON limit must exceed the documented 512 KB image-submit contract.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import * as http from 'node:http'
import express from 'express'
import bodyParser from 'body-parser'
import createError from 'http-errors'
import { errorMiddleware, JSON_BODY_LIMIT } from './middleware'

/** A Drizzle-shaped error: message carries the full query text and params. */
class FakeDrizzleQueryError extends Error {
  query = 'select "token"."address", "image"."content" from "token" where "token"."address" = $1'
  params = ['0xdeadbeef']
  constructor() {
    super(
      'Failed query: select "token"."address", "image"."content" from "token" where "token"."address" = $1\nparams: 0xdeadbeef',
    )
  }
}

function buildApp(): express.Express {
  const app = express()
  app.use(bodyParser.json({ limit: JSON_BODY_LIMIT }))
  app.get('/throws-drizzle', (_req, _res, next) => next(new FakeDrizzleQueryError()))
  app.get('/throws-plain', (_req, _res, next) => next(new Error('secret internal detail')))
  app.get('/throws-500-http-error', (_req, _res, next) => next(createError.InternalServerError('secret detail')))
  app.get('/throws-not-found', (_req, _res, next) => next(createError.NotFound('image not found')))
  app.get('/throws-bad-request', (_req, _res, next) => next(createError.BadRequest('chainId')))
  app.post('/echo', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }))
  app.use(errorMiddleware)
  return app
}

function request(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; body: Record<string, unknown>; raw: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data), raw: data })
          } catch {
            resolve({ status: res.statusCode!, body: {}, raw: data })
          }
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

let port: number
let server: http.Server

describe('middleware', () => {
  beforeAll(async () => {
    server = await new Promise<http.Server>((resolve) => {
      const s = buildApp().listen(0, () => resolve(s))
    })
    port = (server.address() as { port: number }).port
  })

  afterAll(() => server.close())

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('errorMiddleware — sanitizing unexpected errors', () => {
    it('returns a generic 500 for Drizzle-like errors with no SQL in the body', async () => {
      const res = await request(port, 'GET', '/throws-drizzle')
      expect(res.status).toBe(500)
      expect(res.body.error).toBe('internal server error')
      expect(res.raw).not.toContain('select')
      expect(res.raw).not.toContain('0xdeadbeef')
      expect(res.raw).not.toContain('params')
    })

    it('logs the full error server-side when sanitizing', async () => {
      await request(port, 'GET', '/throws-drizzle')
      expect(console.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Failed query') }),
      )
    })

    it('returns a generic 500 for plain errors without forwarding the message', async () => {
      const res = await request(port, 'GET', '/throws-plain')
      expect(res.status).toBe(500)
      expect(res.body.error).toBe('internal server error')
      expect(res.raw).not.toContain('secret internal detail')
    })

    it('sanitizes 5xx http-errors too (expose=false)', async () => {
      const res = await request(port, 'GET', '/throws-500-http-error')
      expect(res.status).toBe(500)
      expect(res.body.error).toBe('internal server error')
      expect(res.raw).not.toContain('secret detail')
    })
  })

  describe('errorMiddleware — preserving intentional client errors', () => {
    it('keeps the message of a 404 created via http-errors', async () => {
      const res = await request(port, 'GET', '/throws-not-found')
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('image not found')
    })

    it('keeps the message of a 400 created via http-errors', async () => {
      const res = await request(port, 'GET', '/throws-bad-request')
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('chainId')
    })
  })

  describe('JSON body limit', () => {
    it('accepts JSON bodies over the old 100 KB default (image submissions up to ~700 KB base64)', async () => {
      const payload = JSON.stringify({ image: 'a'.repeat(700 * 1024) })
      const res = await request(port, 'POST', '/echo', payload)
      expect(res.status).toBe(200)
    })

    it('surfaces oversized bodies as a 413 JSON error via the middleware', async () => {
      const payload = JSON.stringify({ image: 'a'.repeat(1100 * 1024) })
      const res = await request(port, 'POST', '/echo', payload)
      expect(res.status).toBe(413)
      expect(res.body.error).toBe('request entity too large')
    })
  })
})
