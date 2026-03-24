import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import * as http from 'node:http'

/**
 * Mock the db module with a chainable knex-style query builder.
 */
const chain: Record<string, Mock> = {}
chain.insert = vi.fn().mockReturnValue(chain)
chain.into = vi.fn().mockReturnValue(chain)
chain.onConflict = vi.fn().mockReturnValue(chain)
chain.merge = vi.fn().mockReturnValue(chain)
chain.returning = vi.fn().mockResolvedValue([])
chain.select = vi.fn().mockReturnValue(chain)
chain.from = vi.fn().mockReturnValue(chain)
chain.where = vi.fn().mockReturnValue(chain)
chain.orderBy = vi.fn().mockResolvedValue([])
chain.update = vi.fn().mockReturnValue(chain)
chain.increment = vi.fn().mockReturnValue(chain)
chain.first = vi.fn().mockResolvedValue(undefined)

vi.mock('../db', () => ({
  getDB: vi.fn(() => chain),
}))

/**
 * Mock global fetch for the probe validation inside the submit handler.
 */
vi.stubGlobal('fetch', vi.fn())

import express from 'express'
import { router, resolveImageMode } from './submissions'

/** Extracted slugify from source for local assertions */
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)

/**
 * Make an HTTP request using node:http (bypasses the mocked global fetch).
 */
function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) })
          } catch {
            resolve({ status: res.statusCode!, body: {} })
          }
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/** Build an express app and start listening, returning port and cleanup fn */
function startApp(): Promise<{ port: number; close: () => void }> {
  const app = express()
  app.use('/api/lists', router)
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number }
      resolve({ port: addr.port, close: () => server.close() })
    })
  })
}

describe('POST /submit -- input validation', () => {
  let port: number
  let close: () => void

  beforeEach(async () => {
    vi.clearAllMocks()
    const app = await startApp()
    port = app.port
    close = app.close
  })

  afterEach(() => close())

  it('rejects when url is missing', async () => {
    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      name: 'test',
      submittedBy: 'alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('url')
  })

  it('rejects when name is missing', async () => {
    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      submittedBy: 'alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('name')
  })

  it('rejects when submittedBy is missing', async () => {
    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'test',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('submittedBy')
  })

  it('rejects invalid URL format', async () => {
    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'not-a-url',
      name: 'test',
      submittedBy: 'alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid URL')
  })

  it('rejects completely empty body', async () => {
    const res = await httpRequest(port, 'POST', '/api/lists/submit', {})
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('required')
  })
})

describe('POST /submit -- probe validation', () => {
  let port: number
  let close: () => void

  beforeEach(async () => {
    vi.clearAllMocks()
    const app = await startApp()
    port = app.port
    close = app.close
  })

  afterEach(() => close())

  it('rejects when probe returns non-OK status', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 })
    vi.stubGlobal('fetch', mockFetch)

    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'test',
      submittedBy: 'alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('503')
  })

  it('rejects when URL does not serve a token list (no tokens array)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: 'not a token list' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'test',
      submittedBy: 'alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('missing tokens array')
  })

  it('rejects when fetch throws (network error)', async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', mockFetch)

    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'test',
      submittedBy: 'alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('ECONNREFUSED')
  })

  it('succeeds and inserts when probe returns valid token list', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tokens: [{ address: '0x1', name: 'Token' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const insertedRow = {
      id: 'uuid-1',
      status: 'pending',
      provider_key: 'user-alice',
      list_key: 'my-list',
    }
    chain.returning.mockResolvedValueOnce([insertedRow])

    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'My List',
      submittedBy: 'alice',
    })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe('uuid-1')
    expect(res.body.status).toBe('pending')
    expect(res.body.providerKey).toBe('user-alice')
    expect(res.body.listKey).toBe('my-list')

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/list.json',
        name: 'My List',
        submitted_by: 'alice',
        status: 'pending',
        provider_key: 'user-alice',
        list_key: 'my-list',
        image_mode: 'auto',
        fail_count: 0,
        subscriber_count: 0,
      }),
    )
    expect(chain.into).toHaveBeenCalledWith('list_submission')
    expect(chain.onConflict).toHaveBeenCalledWith('url')
    expect(chain.merge).toHaveBeenCalledWith(['name', 'description', 'submitted_by', 'updated_at'])
  })

  it('generates correct provider_key and list_key via slugify', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tokens: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    chain.returning.mockResolvedValueOnce([{
      id: 'uuid-2',
      status: 'pending',
      provider_key: 'user-alice-jones',
      list_key: 'my-fancy-list',
    }])

    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'My Fancy List!',
      submittedBy: 'Alice Jones',
    })

    expect(res.status).toBe(201)
    // Verify the slugified keys were passed to the DB
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_key: 'user-alice-jones',
        list_key: 'my-fancy-list',
      }),
    )
  })

  it('uses empty string for description when not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tokens: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    chain.returning.mockResolvedValueOnce([{
      id: 'uuid-3',
      status: 'pending',
      provider_key: 'user-test',
      list_key: 'test',
    }])

    await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'test',
      submittedBy: 'test',
    })

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ description: '' }),
    )
  })
})

describe('GET /submissions', () => {
  let port: number
  let close: () => void

  beforeEach(async () => {
    vi.clearAllMocks()
    // Re-establish default chain behavior
    chain.select.mockReturnValue(chain)
    chain.from.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    const app = await startApp()
    port = app.port
    close = app.close
  })

  afterEach(() => close())

  it('returns mapped submissions with camelCase keys', async () => {
    const now = new Date()
    const rows = [
      {
        id: 'uuid-1',
        url: 'https://example.com/list.json',
        name: 'My List',
        description: 'A description',
        submitted_by: 'alice',
        status: 'pending',
        provider_key: 'user-alice',
        list_key: 'my-list',
        image_mode: 'auto',
        fail_count: 0,
        subscriber_count: 5,
        last_fetched_at: now,
        created_at: now,
      },
    ]
    chain.orderBy.mockResolvedValueOnce(rows)

    const res = await httpRequest(port, 'GET', '/api/lists/submissions')

    expect(res.status).toBe(200)
    const items = res.body as unknown as unknown[]
    expect(items).toHaveLength(1)
    const item = items[0] as Record<string, unknown>
    expect(item.id).toBe('uuid-1')
    expect(item.submittedBy).toBe('alice')
    expect(item.providerKey).toBe('user-alice')
    expect(item.listKey).toBe('my-list')
    expect(item.imageMode).toBe('auto')
    expect(item.subscriberCount).toBe(5)
  })

  it('returns empty array when no submissions', async () => {
    chain.orderBy.mockResolvedValueOnce([])

    const res = await httpRequest(port, 'GET', '/api/lists/submissions')

    expect(res.status).toBe(200)
    const items = res.body as unknown as unknown[]
    expect(items).toHaveLength(0)
  })

  it('passes status filter to query when query param provided', async () => {
    // orderBy returns the chain (thenable) so .where() can still be called
    chain.orderBy.mockReturnValueOnce(chain)
    // When the chain is finally awaited (after .where), resolve to []
    chain.where.mockResolvedValueOnce([])

    await httpRequest(port, 'GET', '/api/lists/submissions?status=approved')

    expect(chain.where).toHaveBeenCalledWith('status', 'approved')
  })
})

describe('PATCH /submissions/:id', () => {
  let port: number
  let close: () => void

  beforeEach(async () => {
    vi.clearAllMocks()
    chain.update.mockReturnValue(chain)
    chain.from.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    const app = await startApp()
    port = app.port
    close = app.close
  })

  afterEach(() => close())

  it('rejects empty updates (invalid status value)', async () => {
    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', {
      status: 'invalid-status',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Nothing to update')
  })

  it('rejects when no recognized fields provided', async () => {
    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', {
      foo: 'bar',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Nothing to update')
  })

  it('accepts status=approved', async () => {
    chain.returning.mockResolvedValueOnce([
      { id: 'uuid-1', status: 'approved', image_mode: 'auto' },
    ])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', {
      status: 'approved',
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('approved')
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }))
  })

  it('accepts status=rejected', async () => {
    chain.returning.mockResolvedValueOnce([
      { id: 'uuid-1', status: 'rejected', image_mode: 'auto' },
    ])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', {
      status: 'rejected',
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('rejected')
  })

  it('accepts status=stale', async () => {
    chain.returning.mockResolvedValueOnce([
      { id: 'uuid-1', status: 'stale', image_mode: 'auto' },
    ])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', {
      status: 'stale',
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('stale')
  })

  it('accepts imageMode=save', async () => {
    chain.returning.mockResolvedValueOnce([
      { id: 'uuid-1', status: 'pending', image_mode: 'save' },
    ])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', {
      imageMode: 'save',
    })

    expect(res.status).toBe(200)
    expect(res.body.imageMode).toBe('save')
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ image_mode: 'save' }))
  })

  it('accepts imageMode=link', async () => {
    chain.returning.mockResolvedValueOnce([
      { id: 'uuid-1', status: 'pending', image_mode: 'link' },
    ])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', {
      imageMode: 'link',
    })

    expect(res.status).toBe(200)
    expect(res.body.imageMode).toBe('link')
  })

  it('accepts imageMode=auto', async () => {
    chain.returning.mockResolvedValueOnce([
      { id: 'uuid-1', status: 'pending', image_mode: 'auto' },
    ])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', {
      imageMode: 'auto',
    })

    expect(res.status).toBe(200)
    expect(res.body.imageMode).toBe('auto')
  })

  it('rejects invalid imageMode', async () => {
    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', {
      imageMode: 'invalid',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Nothing to update')
  })

  it('accepts both status and imageMode simultaneously', async () => {
    chain.returning.mockResolvedValueOnce([
      { id: 'uuid-1', status: 'approved', image_mode: 'save' },
    ])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', {
      status: 'approved',
      imageMode: 'save',
    })

    expect(res.status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', image_mode: 'save' }),
    )
  })

  it('returns 404 when submission not found', async () => {
    chain.returning.mockResolvedValueOnce([])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/nonexistent', {
      status: 'rejected',
    })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Submission not found')
  })

  it('passes the correct id to the where clause', async () => {
    chain.returning.mockResolvedValueOnce([
      { id: 'specific-uuid', status: 'approved', image_mode: 'auto' },
    ])

    await httpRequest(port, 'PATCH', '/api/lists/submissions/specific-uuid', {
      status: 'approved',
    })

    expect(chain.where).toHaveBeenCalledWith('id', 'specific-uuid')
  })
})

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(slugify('My Token List!')).toBe('my-token-list')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugify('--test--')).toBe('test')
  })

  it('truncates to 64 characters', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long).length).toBeLessThanOrEqual(64)
  })

  it('collapses multiple special chars to single hyphen', () => {
    expect(slugify('hello   world---test')).toBe('hello-world-test')
  })

  it('handles mixed case and special characters', () => {
    expect(slugify('CoinGecko_Ethereum (V2)')).toBe('coingecko-ethereum-v2')
  })

  it('returns empty string for all-special-character input', () => {
    expect(slugify('!!!@@@###')).toBe('')
  })
})

describe('resolveImageMode', () => {
  it('auto mode + >= 100 subscribers resolves to save', () => {
    expect(resolveImageMode({ image_mode: 'auto', subscriber_count: 100 })).toBe('save')
    expect(resolveImageMode({ image_mode: 'auto', subscriber_count: 200 })).toBe('save')
  })

  it('auto mode + exactly 100 subscribers resolves to save', () => {
    expect(resolveImageMode({ image_mode: 'auto', subscriber_count: 100 })).toBe('save')
  })

  it('auto mode + < 100 subscribers resolves to link', () => {
    expect(resolveImageMode({ image_mode: 'auto', subscriber_count: 99 })).toBe('link')
    expect(resolveImageMode({ image_mode: 'auto', subscriber_count: 0 })).toBe('link')
  })

  it('save mode + < 10 subscribers + stale access (>30 days) resolves to link', () => {
    const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    expect(resolveImageMode({
      image_mode: 'save',
      subscriber_count: 9,
      last_accessed_at: staleDate,
    })).toBe('link')
  })

  it('save mode + < 10 subscribers + recent access returns null', () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    expect(resolveImageMode({
      image_mode: 'save',
      subscriber_count: 9,
      last_accessed_at: recentDate,
    })).toBeNull()
  })

  it('save mode + >= 10 subscribers returns null regardless of access time', () => {
    const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    expect(resolveImageMode({
      image_mode: 'save',
      subscriber_count: 10,
      last_accessed_at: staleDate,
    })).toBeNull()
  })

  it('save mode + exactly 10 subscribers returns null', () => {
    const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    expect(resolveImageMode({
      image_mode: 'save',
      subscriber_count: 10,
      last_accessed_at: staleDate,
    })).toBeNull()
  })

  it('save mode + < 10 subscribers + null last_accessed_at resolves to link (Infinity days)', () => {
    expect(resolveImageMode({
      image_mode: 'save',
      subscriber_count: 9,
      last_accessed_at: null,
    })).toBe('link')
  })

  it('save mode + < 10 subscribers + undefined last_accessed_at resolves to link (Infinity days)', () => {
    expect(resolveImageMode({
      image_mode: 'save',
      subscriber_count: 9,
    })).toBe('link')
  })

  it('link mode returns null (no transition needed)', () => {
    expect(resolveImageMode({ image_mode: 'link', subscriber_count: 0 })).toBeNull()
    expect(resolveImageMode({ image_mode: 'link', subscriber_count: 200 })).toBeNull()
  })

  it('unknown mode returns null', () => {
    expect(resolveImageMode({ image_mode: 'unknown', subscriber_count: 50 })).toBeNull()
  })
})
