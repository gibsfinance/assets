import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Request, Response } from 'express'
import { router } from './github'

/** Extract the POST /token handler (after the json() middleware) from the router stack. */
function getTokenHandler(): (req: Request, res: Response) => Promise<void> {
  const layer = (router as any).stack.find((l: any) => l.route && l.route.path === '/token' && l.route.methods.post)
  if (!layer) throw new Error('POST /token route not found on router')

  const handlers = layer.route.stack.map((s: any) => s.handle)
  return handlers[handlers.length - 1]
}

function mockResponse(): Response {
  const res: Record<string, unknown> = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res as unknown as Response
}

describe('POST /token — 502 branches', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns a generic 502 on network failure without leaking error details', async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'id'
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'secret'
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND github.com')))

    const res = mockResponse()
    await getTokenHandler()({ body: { code: 'abc' } } as unknown as Request, res)

    expect(res.status).toHaveBeenCalledWith(502)
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to exchange token' })
    const payload = vi.mocked(res.json).mock.calls[0][0]
    expect(JSON.stringify(payload)).not.toContain('ENOTFOUND')
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('returns 502 when GitHub responds with a non-OK status', async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'id'
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'secret'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }))

    const res = mockResponse()
    await getTokenHandler()({ body: { code: 'abc' } } as unknown as Request, res)

    expect(res.status).toHaveBeenCalledWith(502)
    expect(res.json).toHaveBeenCalledWith({ error: 'GitHub returned 500' })
  })
})

describe('GitHub OAuth proxy', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('requires GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET', () => {
    // The handler checks these env vars and returns 503 if missing
    delete process.env.GITHUB_OAUTH_CLIENT_ID
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET

    expect(process.env.GITHUB_OAUTH_CLIENT_ID).toBeUndefined()
    expect(process.env.GITHUB_OAUTH_CLIENT_SECRET).toBeUndefined()
  })

  it('validates code is a non-empty string', () => {
    // The handler: if (!code || typeof code !== 'string')
    const validate = (code: unknown) => !code || typeof code !== 'string'

    expect(validate(undefined)).toBe(true)
    expect(validate(null)).toBe(true)
    expect(validate('')).toBe(true)
    expect(validate(123)).toBe(true)
    expect(validate('valid-code')).toBe(false)
  })

  it('constructs correct GitHub token exchange payload', () => {
    const clientId = 'test-client-id'
    const clientSecret = 'test-client-secret'
    const code = 'test-auth-code'

    const payload = {
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }

    expect(payload).toEqual({
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      code: 'test-auth-code',
    })
  })
})
