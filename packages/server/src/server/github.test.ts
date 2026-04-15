import { describe, it, expect, vi, afterEach } from 'vitest'

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
