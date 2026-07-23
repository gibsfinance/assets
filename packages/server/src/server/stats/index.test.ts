/**
 * Tests for the /stats endpoint.
 *
 * Why these matter: /stats is fetched by every UI load via useMetrics — it
 * must carry the same cache-control header as /networks, and chainId must be
 * the bare string form with chainIdentifier carrying the prefixed form.
 */
import { describe, it, expect, vi } from 'vitest'
import * as http from 'node:http'
import express from 'express'

vi.mock('../../db', () => ({
  getTokenCountsByChain: vi.fn(async () => [
    { chainId: 'eip155-369', count: 1200 },
    { chainId: 'eip155-1', count: 800 },
  ]),
}))

// A known admin token so the refresh-parameter gate has something to accept
// and something to reject — the endpoint fails closed without one configured.
vi.mock('../../../config', async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>('../../../config')
  return { default: { ...actual.default, adminToken: 'test-admin-token' } }
})

import { router } from './index'
import { errorMiddleware } from '../middleware'

function get(
  port: number,
  path: string,
  headers: http.OutgoingHttpHeaders = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path, headers }, (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: JSON.parse(data) }))
      })
      .on('error', reject)
  })
}

function startApp(): Promise<{ port: number; close: () => void }> {
  const app = express()
  app.use('/stats', router)
  app.use(errorMiddleware)
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number }
      resolve({ port: addr.port, close: () => server.close() })
    })
  })
}

describe('GET /stats', () => {
  it('sets the public cache-control header and maps chain ids to bare strings', async () => {
    const { port, close } = await startApp()
    try {
      const res = await get(port, '/stats')

      expect(res.status).toBe(200)
      expect(res.headers['cache-control']).toMatch(/^public, max-age=\d+$/)
      expect(res.body).toEqual([
        { chainId: '369', chainIdentifier: 'eip155-369', count: 1200 },
        { chainId: '1', chainIdentifier: 'eip155-1', count: 800 },
      ])
    } finally {
      close()
    }
  })

  // Regression guard: silently serving the cached counts on an unauthorized
  // refresh would read as confirmation a deploy landed when it did not.
  it('rejects an unauthenticated refresh request with 401', async () => {
    const { port, close } = await startApp()
    try {
      const res = await get(port, '/stats?refresh=1')
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  // An authorized refresh both drops the process-local memo (so the handler
  // actually re-reads the database) and marks the response no-store.
  it('drops the cached memo and serves no-store for an authorized refresh', async () => {
    const { port, close } = await startApp()
    try {
      const res = await get(port, '/stats?refresh=1', { authorization: 'Bearer test-admin-token' })
      expect(res.status).toBe(200)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body).toEqual([
        { chainId: '369', chainIdentifier: 'eip155-369', count: 1200 },
        { chainId: '1', chainIdentifier: 'eip155-1', count: 800 },
      ])
    } finally {
      close()
    }
  })
})
