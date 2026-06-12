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

import { router } from './index'

function get(
  port: number,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path }, (res) => {
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
})
