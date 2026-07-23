import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import * as http from 'node:http'

/**
 * Mock the Drizzle module with a chainable query builder.
 */
const chain: Record<string, Mock> = {}
chain.insert = vi.fn().mockReturnValue(chain)
chain.values = vi.fn().mockReturnValue(chain)
chain.onConflictDoUpdate = vi.fn().mockReturnValue(chain)
chain.returning = vi.fn().mockResolvedValue([])
chain.select = vi.fn().mockReturnValue(chain)
chain.from = vi.fn().mockReturnValue(chain)
chain.where = vi.fn().mockReturnValue(chain)
chain.orderBy = vi.fn().mockReturnValue(chain)
chain.update = vi.fn().mockReturnValue(chain)
chain.set = vi.fn().mockReturnValue(chain)
chain.$dynamic = vi.fn().mockReturnValue(chain)
// Make the chain thenable (for awaited queries)
chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(chain))

vi.mock('../db/drizzle', () => ({
  getDrizzle: vi.fn(() => chain),
}))

// Mock schema — just provide the table/column references the code uses
vi.mock('../db/schema', () => {
  const makeTable = (name: string) =>
    new Proxy(
      {},
      {
        get: (_, prop) => `${name}.${String(prop)}`,
      },
    )
  return {
    listSubmission: makeTable('list_submission'),
  }
})

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  desc: vi.fn((...args: unknown[]) => ({ type: 'desc', args })),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => args),
    {
      raw: vi.fn((s: string) => s),
    },
  ),
}))

// Provide a deterministic admin token for the auth-guarded routes
vi.mock('../../config', () => ({ default: { adminToken: 'test-admin-token' } }))

/**
 * Mock the URL guard so tests never resolve DNS. The default implementation
 * mirrors the real syntax check ('Invalid URL') and accepts everything else;
 * individual tests override it to exercise rejection paths.
 */
const urlGuard = vi.hoisted(() => ({
  validateOutboundUrl: vi.fn(),
}))
vi.mock('./url-guard', () => urlGuard)
const defaultValidateOutboundUrl = async (rawUrl: string) => {
  try {
    return { ok: true as const, url: new URL(rawUrl) }
  } catch {
    return { ok: false as const, reason: 'Invalid URL' }
  }
}
urlGuard.validateOutboundUrl.mockImplementation(defaultValidateOutboundUrl)

/**
 * Mock global fetch for the probe validation inside the submit handler.
 */
vi.stubGlobal('fetch', vi.fn())

import express from 'express'
import { router, resolveImageMode } from './submissions'
import { errorMiddleware } from './middleware'

const ADMIN_HEADERS = { authorization: 'Bearer test-admin-token' }

/** Extracted slugify from source for local assertions */
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)

/**
 * Make an HTTP request using node:http (bypasses the mocked global fetch).
 */
function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
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
          ...headers,
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
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
  // Same error funnel as the real app — unexpected errors become generic 500s
  app.use(errorMiddleware)
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

  it('rejects when probe returns non-OK status, without echoing the upstream status code', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 })
    vi.stubGlobal('fetch', mockFetch)

    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'test',
      submittedBy: 'alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('URL did not return a valid token list')
    expect(JSON.stringify(res.body)).not.toContain('503')
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
    expect(res.body.error).toBe('URL did not return a valid token list')
  })

  it('rejects when fetch throws (network error) with a generic message', async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', mockFetch)

    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'test',
      submittedBy: 'alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('URL did not return a valid token list')
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED')
  })

  it('rejects URLs the outbound guard flags (server-side request forgery) and never fetches them', async () => {
    urlGuard.validateOutboundUrl.mockResolvedValueOnce({
      ok: false,
      reason: 'URL resolves to a private or internal address',
    })
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'http://169.254.169.254/latest/meta-data',
      name: 'test',
      submittedBy: 'alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('URL resolves to a private or internal address')
    expect(mockFetch).not.toHaveBeenCalled()
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
      providerKey: 'user-alice',
      listKey: 'my-list',
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

    expect(chain.insert).toHaveBeenCalled()
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/list.json',
        name: 'My List',
        submittedBy: 'alice',
        status: 'pending',
        providerKey: 'user-alice',
        listKey: 'my-list',
        imageMode: 'auto',
        failCount: 0,
        subscriberCount: 0,
      }),
    )
  })

  it('generates correct providerKey and listKey via slugify', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tokens: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    chain.returning.mockResolvedValueOnce([
      {
        id: 'uuid-2',
        status: 'pending',
        providerKey: 'user-alice-jones',
        listKey: 'my-fancy-list',
      },
    ])

    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'My Fancy List!',
      submittedBy: 'Alice Jones',
    })

    expect(res.status).toBe(201)
    // Verify the slugified keys were passed to the DB
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKey: 'user-alice-jones',
        listKey: 'my-fancy-list',
      }),
    )
  })

  it('uses empty string for description when not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tokens: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    chain.returning.mockResolvedValueOnce([
      {
        id: 'uuid-3',
        status: 'pending',
        providerKey: 'user-test',
        listKey: 'test',
      },
    ])

    await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'test',
      submittedBy: 'test',
    })

    expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({ description: '' }))
  })
})

describe('GET /submissions', () => {
  let port: number
  let close: () => void

  beforeEach(async () => {
    vi.clearAllMocks()
    // Make the chain resolve to empty array when awaited
    chain.select.mockReturnValue(chain)
    chain.from.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    chain.orderBy.mockReturnValue(chain)
    chain.$dynamic.mockReturnValue(chain)
    const app = await startApp()
    port = app.port
    close = app.close
  })

  afterEach(() => close())

  it('returns mapped submissions with camelCase keys', async () => {
    const now = new Date().toISOString()
    const rows = [
      {
        id: 'uuid-1',
        url: 'https://example.com/list.json',
        name: 'My List',
        description: 'A description',
        submittedBy: 'alice',
        status: 'pending',
        providerKey: 'user-alice',
        listKey: 'my-list',
        imageMode: 'auto',
        failCount: 0,
        subscriberCount: 5,
        lastFetchedAt: now,
        createdAt: now,
      },
    ]
    // The $dynamic chain resolves via .then
    chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(rows))

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
    chain.then = vi.fn((resolve: (v: unknown) => void) => resolve([]))

    const res = await httpRequest(port, 'GET', '/api/lists/submissions')

    expect(res.status).toBe(200)
    const items = res.body as unknown as unknown[]
    expect(items).toHaveLength(0)
  })

  it('applies status filter when query param is provided', async () => {
    chain.then = vi.fn((resolve: (v: unknown) => void) => resolve([]))

    const res = await httpRequest(port, 'GET', '/api/lists/submissions?status=pending')

    expect(res.status).toBe(200)
    expect(chain.where).toHaveBeenCalled()
  })
})

describe('PATCH /submissions/:id', () => {
  let port: number
  let close: () => void

  beforeEach(async () => {
    vi.clearAllMocks()
    chain.update.mockReturnValue(chain)
    chain.set.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    const app = await startApp()
    port = app.port
    close = app.close
  })

  afterEach(() => close())

  it('responds 401 without a bearer token', async () => {
    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', { status: 'approved' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthorized')
  })

  it('responds 401 with a mismatched bearer token', async () => {
    const res = await httpRequest(
      port,
      'PATCH',
      '/api/lists/submissions/uuid-1',
      { status: 'approved' },
      { authorization: 'Bearer wrong-token' },
    )
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthorized')
  })

  it('rejects invalid status values with a message listing the allowed values', async () => {
    const res = await httpRequest(
      port,
      'PATCH',
      '/api/lists/submissions/uuid-1',
      { status: 'invalid-status' },
      ADMIN_HEADERS,
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Invalid status')
    expect(res.body.error).toContain('pending, approved, rejected, stale')
  })

  it('rejects when no recognized fields provided', async () => {
    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', { foo: 'bar' }, ADMIN_HEADERS)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Nothing to update')
  })

  it('accepts status=approved', async () => {
    chain.returning.mockResolvedValueOnce([{ id: 'uuid-1', status: 'approved', imageMode: 'auto' }])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', { status: 'approved' }, ADMIN_HEADERS)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('approved')
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }))
  })

  it('returns the full updated submission shape, not just id/status/imageMode', async () => {
    const now = new Date().toISOString()
    chain.returning.mockResolvedValueOnce([
      {
        id: 'uuid-1',
        url: 'https://example.com/list.json',
        name: 'My List',
        description: 'A description',
        submittedBy: 'alice',
        status: 'approved',
        providerKey: 'user-alice',
        listKey: 'my-list',
        imageMode: 'auto',
        failCount: 0,
        subscriberCount: 5,
        lastFetchedAt: now,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        lastContentHash: 'hash',
      },
    ])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', { status: 'approved' }, ADMIN_HEADERS)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      id: 'uuid-1',
      url: 'https://example.com/list.json',
      name: 'My List',
      description: 'A description',
      submittedBy: 'alice',
      status: 'approved',
      providerKey: 'user-alice',
      listKey: 'my-list',
      imageMode: 'auto',
      failCount: 0,
      subscriberCount: 5,
      lastFetchedAt: now,
      createdAt: now,
    })
  })

  it('accepts imageMode=save', async () => {
    chain.returning.mockResolvedValueOnce([{ id: 'uuid-1', status: 'pending', imageMode: 'save' }])

    const res = await httpRequest(port, 'PATCH', '/api/lists/submissions/uuid-1', { imageMode: 'save' }, ADMIN_HEADERS)

    expect(res.status).toBe(200)
    expect(res.body.imageMode).toBe('save')
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ imageMode: 'save' }))
  })

  it('accepts both status and imageMode together', async () => {
    chain.returning.mockResolvedValueOnce([{ id: 'uuid-1', status: 'approved', imageMode: 'link' }])

    const res = await httpRequest(
      port,
      'PATCH',
      '/api/lists/submissions/uuid-1',
      { status: 'approved', imageMode: 'link' },
      ADMIN_HEADERS,
    )

    expect(res.status).toBe(200)
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', imageMode: 'link' }))
  })

  it('rejects invalid imageMode values with a message listing the allowed values', async () => {
    const res = await httpRequest(
      port,
      'PATCH',
      '/api/lists/submissions/uuid-1',
      { imageMode: 'invalid' },
      ADMIN_HEADERS,
    )

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Invalid imageMode')
    expect(res.body.error).toContain('link, save, auto')
  })

  it('returns 404 when submission not found', async () => {
    chain.returning.mockResolvedValueOnce([])

    const res = await httpRequest(
      port,
      'PATCH',
      '/api/lists/submissions/nonexistent',
      { status: 'rejected' },
      ADMIN_HEADERS,
    )

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Submission not found')
  })
})

describe('GET /submissions/approved', () => {
  let port: number
  let close: () => void

  beforeEach(async () => {
    vi.clearAllMocks()
    chain.select.mockReturnValue(chain)
    chain.from.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    chain.orderBy.mockReturnValue(chain)
    chain.update.mockReturnValue(chain)
    chain.set.mockReturnValue(chain)
    chain.returning.mockResolvedValue([])
    const app = await startApp()
    port = app.port
    close = app.close
  })

  afterEach(() => close())

  it('responds 401 without the admin bearer token', async () => {
    const res = await httpRequest(port, 'GET', '/api/lists/submissions/approved')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthorized')
  })

  it('returns approved submissions mapped for collector', async () => {
    const rows = [
      {
        id: 'uuid-1',
        url: 'https://example.com/list.json',
        providerKey: 'user-alice',
        listKey: 'my-list',
        imageMode: 'save',
        subscriberCount: 50,
        lastAccessedAt: new Date().toISOString(),
        lastContentHash: 'abc123',
        status: 'approved',
      },
    ]
    chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(rows))

    const res = await httpRequest(port, 'GET', '/api/lists/submissions/approved', undefined, ADMIN_HEADERS)

    expect(res.status).toBe(200)
    const items = res.body as unknown as unknown[]
    expect(items).toHaveLength(1)
    const item = items[0] as Record<string, unknown>
    expect(item.url).toBe('https://example.com/list.json')
    expect(item.providerKey).toBe('user-alice')
    expect(item.listKey).toBe('my-list')
    expect(item.imageMode).toBe('save')
    expect(item.lastContentHash).toBe('abc123')
  })

  it('auto-upgrades imageMode when resolveImageMode returns a new mode', async () => {
    const rows = [
      {
        id: 'uuid-auto',
        url: 'https://example.com/list.json',
        providerKey: 'user-bob',
        listKey: 'bobs-list',
        imageMode: 'auto',
        subscriberCount: 200,
        lastAccessedAt: new Date().toISOString(),
        lastContentHash: null,
        status: 'approved',
      },
    ]
    chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(rows))

    const res = await httpRequest(port, 'GET', '/api/lists/submissions/approved', undefined, ADMIN_HEADERS)

    expect(res.status).toBe(200)
    const items = res.body as unknown as unknown[]
    expect(items).toHaveLength(1)
    // auto + 200 subscribers → save
    expect((items[0] as Record<string, unknown>).imageMode).toBe('save')
    // Should have updated the DB
    expect(chain.update).toHaveBeenCalled()
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ imageMode: 'save' }))
  })

  it('reports any mode other than save as link, so the collector never guesses', async () => {
    const rows = [
      {
        id: 'uuid-low',
        url: 'https://example.com/list.json',
        providerKey: 'user-carol',
        listKey: 'carols-list',
        // auto with too few subscribers to earn image storage — resolveImageMode
        // leaves it alone, so the row reaches the response still set to 'auto'.
        imageMode: 'auto',
        subscriberCount: 1,
        lastAccessedAt: new Date().toISOString(),
        lastContentHash: null,
        status: 'approved',
      },
    ]
    chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(rows))

    const res = await httpRequest(port, 'GET', '/api/lists/submissions/approved', undefined, ADMIN_HEADERS)

    expect(res.status).toBe(200)
    const items = res.body as unknown as unknown[]
    // The collector only understands 'save' and 'link'; leaking 'auto' here
    // would hand it a third value it has no branch for.
    expect((items[0] as Record<string, unknown>).imageMode).toBe('link')
  })

  it('returns empty array when no approved submissions', async () => {
    chain.then = vi.fn((resolve: (v: unknown) => void) => resolve([]))

    const res = await httpRequest(port, 'GET', '/api/lists/submissions/approved', undefined, ADMIN_HEADERS)

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('POST /submit -- DB error path', () => {
  let port: number
  let close: () => void

  beforeEach(async () => {
    vi.clearAllMocks()
    chain.insert.mockReturnValue(chain)
    chain.values.mockReturnValue(chain)
    chain.onConflictDoUpdate.mockReturnValue(chain)
    const app = await startApp()
    port = app.port
    close = app.close
  })

  afterEach(() => close())

  it('returns a generic 500 when DB insert throws — no internals leak to clients', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tokens: [{ address: '0x1', name: 'Token' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    chain.returning.mockRejectedValueOnce(new Error('Failed query: insert into "list_submission" ...'))

    const res = await httpRequest(port, 'POST', '/api/lists/submit', {
      url: 'https://example.com/list.json',
      name: 'My List',
      submittedBy: 'alice',
    })

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('internal server error')
    expect(JSON.stringify(res.body)).not.toContain('Failed query')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
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
    expect(
      resolveImageMode({
        image_mode: 'save',
        subscriber_count: 9,
        last_accessed_at: staleDate,
      }),
    ).toBe('link')
  })

  it('save mode + < 10 subscribers + recent access returns null', () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    expect(
      resolveImageMode({
        image_mode: 'save',
        subscriber_count: 9,
        last_accessed_at: recentDate,
      }),
    ).toBeNull()
  })

  it('save mode + >= 10 subscribers returns null regardless of access time', () => {
    const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    expect(
      resolveImageMode({
        image_mode: 'save',
        subscriber_count: 10,
        last_accessed_at: staleDate,
      }),
    ).toBeNull()
  })

  it('save mode + < 10 subscribers + null last_accessed_at resolves to link (Infinity days)', () => {
    expect(
      resolveImageMode({
        image_mode: 'save',
        subscriber_count: 9,
        last_accessed_at: null,
      }),
    ).toBe('link')
  })

  it('link mode returns null (no transition needed)', () => {
    expect(resolveImageMode({ image_mode: 'link', subscriber_count: 0 })).toBeNull()
    expect(resolveImageMode({ image_mode: 'link', subscriber_count: 200 })).toBeNull()
  })

  it('unknown mode returns null', () => {
    expect(resolveImageMode({ image_mode: 'unknown', subscriber_count: 50 })).toBeNull()
  })
})
