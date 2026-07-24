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
    name: 'PulseChain',
    title: 'PulseChain Mainnet',
    imageHash: 'abc123hash',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  {
    networkId: 'network-asset-0',
    type: 'asset',
    chainId: 'asset-0',
    name: null,
    title: null,
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

// A known admin token so the refresh-parameter gate has something to accept
// and something to reject — the endpoint fails closed without one configured.
vi.mock('../../../config', async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>('../../../config')
  return { default: { ...actual.default, adminToken: 'test-admin-token' } }
})

import { router, toPublicNetwork } from './index'
import { errorMiddleware } from '../middleware'
import type { Network } from '../../db/schema-types'

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
  app.use('/networks', router)
  app.use(errorMiddleware)
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
    expect(Object.keys(mapped).sort()).toEqual([
      'chainId',
      'chainIdentifier',
      'imageHash',
      'name',
      'networkId',
      'title',
      'type',
    ])
  })

  it('exposes the bare chain id as chainId and the prefixed form as chainIdentifier', () => {
    const mapped = toPublicNetwork(fixtureRows[0] as unknown as Network)
    expect(mapped.chainId).toBe('369')
    expect(mapped.chainIdentifier).toBe('eip155-369')
  })

  it('passes the stored naming through', () => {
    const mapped = toPublicNetwork(fixtureRows[0] as unknown as Network)
    expect(mapped.name).toBe('PulseChain')
    expect(mapped.title).toBe('PulseChain Mainnet')
  })

  // Null must survive as null rather than becoming undefined and dropping out of the
  // JSON entirely — the client keys its fallback off an explicit "no name from upstream".
  it('keeps missing naming as explicit nulls', () => {
    const mapped = toPublicNetwork(fixtureRows[1] as unknown as Network)
    expect(mapped.name).toBeNull()
    expect(mapped.title).toBeNull()
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
      expect(Object.keys(networks[0]).sort()).toEqual([
        'chainId',
        'chainIdentifier',
        'imageHash',
        'name',
        'networkId',
        'title',
        'type',
      ])
      expect(networks[0]).toEqual({
        networkId: 'network-evm-369',
        type: 'evm',
        chainId: '369',
        chainIdentifier: 'eip155-369',
        name: 'PulseChain',
        title: 'PulseChain Mainnet',
        imageHash: 'abc123hash',
      })
    } finally {
      close()
    }
  })

  // Regression guard: silently serving the cached body on an unauthorized
  // refresh would read to an operator as confirmation a deploy landed when it
  // did not — the endpoint must fail loudly with 401 instead.
  it('rejects an unauthenticated refresh request with 401', async () => {
    const { port, close } = await startApp()
    try {
      const res = await get(port, '/networks?refresh=1')
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
      const res = await get(port, '/networks?refresh=1', { authorization: 'Bearer test-admin-token' })
      expect(res.status).toBe(200)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body).toEqual([
        {
          networkId: 'network-evm-369',
          type: 'evm',
          chainId: '369',
          chainIdentifier: 'eip155-369',
          name: 'PulseChain',
          title: 'PulseChain Mainnet',
          imageHash: 'abc123hash',
        },
      ])
    } finally {
      close()
    }
  })
})
