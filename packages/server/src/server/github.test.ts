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
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects a missing code with 400 before any network call is made', async () => {
    const res = mockResponse()
    await getTokenHandler()({ body: {} } as unknown as Request, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing code parameter' })
  })

  it('rejects a non-string code with 400', async () => {
    const res = mockResponse()
    await getTokenHandler()({ body: { code: 123 } } as unknown as Request, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing code parameter' })
  })

  it('returns 503 when GitHub OAuth client credentials are not configured', async () => {
    delete process.env.GITHUB_OAUTH_CLIENT_ID
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = mockResponse()
    await getTokenHandler()({ body: { code: 'abc' } } as unknown as Request, res)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({ error: 'GitHub OAuth not configured' })
    // Fail before any outbound call — an unconfigured proxy must not reach GitHub.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards GitHub error responses (e.g. bad_verification_code) as a 400', async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'id'
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'secret'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ error: 'bad_verification_code', error_description: 'the code has expired' }),
      }),
    )

    const res = mockResponse()
    await getTokenHandler()({ body: { code: 'expired' } } as unknown as Request, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: 'bad_verification_code',
      error_description: 'the code has expired',
    })
  })

  it('exchanges a valid code for an access token', async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client-id'
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-client-secret'
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'gho_abc123' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = mockResponse()
    await getTokenHandler()({ body: { code: 'valid-code' } } as unknown as Request, res)

    // The upstream request carries the configured credentials and the caller's code —
    // the entire point of this proxy is bridging those three into GitHub's exchange.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          code: 'valid-code',
        }),
      }),
    )
    expect(res.json).toHaveBeenCalledWith({ access_token: 'gho_abc123' })
  })
})
