/**
 * Tests for the /networks endpoint response shape.
 *
 * Why these matter: the handler used to spread whole database rows, leaking
 * internal createdAt/updatedAt columns; and the asset-0 sentinel row is
 * internal bookkeeping that /stats already filters — /networks must match.
 */
import { describe, it, expect, vi } from 'vitest'
import * as http from 'node:http'
import express from 'express'

const fixtureRows = [
  {
    networkId: 'network-evm-369',
    type: 'evm',
    chainId: 'eip155-369',
    imageHash: 'abc123hash',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  {
    networkId: 'network-asset-0',
    type: 'asset',
    chainId: 'asset-0',
    imageHash: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
]

vi.mock('../../db/drizzle', () => ({
  getDrizzle: vi.fn(() => ({
    select: () => ({ from: () => Promise.resolve(fixtureRows) }),
  })),
}))

vi.mock('../../db/schema', () => ({ network: {} }))

import { router, toPublicNetwork } from './index'
import type { Network } from '../../db/schema-types'

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
  app.use('/networks', router)
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number }
      resolve({ port: addr.port, close: () => server.close() })
    })
  })
}

describe('toPublicNetwork', () => {
  it('picks exactly the public fields — internal timestamps never leak', () => {
    const mapped = toPublicNetwork(fixtureRows[0] as unknown as Network)
    expect(Object.keys(mapped).sort()).toEqual(['chainId', 'chainIdentifier', 'imageHash', 'networkId', 'type'])
  })

  it('exposes the bare chain id as chainId and the prefixed form as chainIdentifier', () => {
    const mapped = toPublicNetwork(fixtureRows[0] as unknown as Network)
    expect(mapped.chainId).toBe('369')
    expect(mapped.chainIdentifier).toBe('eip155-369')
  })
})

describe('GET /networks', () => {
  it('returns explicit fields only, filters asset-0, and sets cache-control', async () => {
    const { port, close } = await startApp()
    try {
      const res = await get(port, '/networks')

      expect(res.status).toBe(200)
      expect(res.headers['cache-control']).toMatch(/^public, max-age=\d+$/)

      const networks = res.body as Record<string, unknown>[]
      expect(networks).toHaveLength(1)
      expect(Object.keys(networks[0]).sort()).toEqual(['chainId', 'chainIdentifier', 'imageHash', 'networkId', 'type'])
      expect(networks[0]).toEqual({
        networkId: 'network-evm-369',
        type: 'evm',
        chainId: '369',
        chainIdentifier: 'eip155-369',
        imageHash: 'abc123hash',
      })
    } finally {
      close()
    }
  })
})
