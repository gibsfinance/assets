import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  toTokenListJson,
  createGitHubPublisher,
  createGitLabPublisher,
  createGiteaPublisher,
  handleOAuthCallback,
} from './useVCSPublish'
import type { LocalList } from './useLocalLists'

const TOKEN_STORAGE_KEY = 'gib-vcs-tokens'
const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Seed a valid (non-expired) structured token entry directly into localStorage */
function seedToken(provider: string, token: string, storedAt = Date.now()): void {
  const existing = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '{}')
  existing[provider] = { token, storedAt }
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(existing))
}

/** Seed an expired structured token entry (>30 days old) */
function seedExpiredToken(provider: string, token: string): void {
  const expiredAt = Date.now() - TOKEN_MAX_AGE_MS - 1
  seedToken(provider, token, expiredAt)
}

/** Seed a legacy plain-string token entry (no timestamp) */
function seedLegacyToken(provider: string, token: string): void {
  const existing = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '{}')
  existing[provider] = token
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(existing))
}

describe('toTokenListJson', () => {
  const makeList = (overrides?: Partial<LocalList>): LocalList => ({
    id: 'test-id',
    name: 'Test List',
    description: 'A test list',
    tokens: [
      {
        chainId: 1,
        address: '0xabc',
        name: 'Token A',
        symbol: 'TKNA',
        decimals: 18,
        imageUri: 'https://example.com/a.png',
        order: 0,
      },
      {
        chainId: 1,
        address: '0xdef',
        name: 'Token B',
        symbol: 'TKNB',
        decimals: 6,
        order: 1,
      },
    ],
    source: { type: 'scratch' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  })

  it('produces valid Uniswap token list JSON', () => {
    const json = toTokenListJson(makeList())
    const parsed = JSON.parse(json)
    expect(parsed.name).toBe('Test List')
    expect(parsed.version).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(parsed.tokens).toHaveLength(2)
    expect(parsed.timestamp).toBeDefined()
  })

  it('includes logoURI only when imageUri is set', () => {
    const json = toTokenListJson(makeList())
    const parsed = JSON.parse(json)
    expect(parsed.tokens[0].logoURI).toBe('https://example.com/a.png')
    expect(parsed.tokens[1].logoURI).toBeUndefined()
  })

  it('maps token fields correctly', () => {
    const json = toTokenListJson(makeList())
    const parsed = JSON.parse(json)
    const token = parsed.tokens[0]
    expect(token.chainId).toBe(1)
    expect(token.address).toBe('0xabc')
    expect(token.name).toBe('Token A')
    expect(token.symbol).toBe('TKNA')
    expect(token.decimals).toBe(18)
  })

  it('handles empty token list', () => {
    const json = toTokenListJson(makeList({ tokens: [] }))
    const parsed = JSON.parse(json)
    expect(parsed.tokens).toEqual([])
  })

  it('produces valid JSON string', () => {
    const json = toTokenListJson(makeList())
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('omits internal fields like order and imageUri key name', () => {
    const json = toTokenListJson(makeList())
    const parsed = JSON.parse(json)
    expect(parsed.tokens[0]).not.toHaveProperty('order')
    expect(parsed.tokens[0]).not.toHaveProperty('imageUri')
  })
})

describe('createGitHubPublisher', () => {
  it('creates a publisher with correct name and icon', () => {
    const publisher = createGitHubPublisher('https://gib.show')
    expect(publisher.name).toBe('GitHub')
    expect(publisher.icon).toBe('fab fa-github')
  })

  it('starts unauthorized', () => {
    const publisher = createGitHubPublisher('https://gib.show')
    expect(publisher.isAuthorized()).toBe(false)
  })
})

describe('createGitLabPublisher', () => {
  it('creates a publisher with correct name for gitlab.com', () => {
    const publisher = createGitLabPublisher({
      clientId: 'test-id',
      serverBaseUrl: 'https://gib.show',
    })
    expect(publisher.name).toBe('GitLab')
    expect(publisher.icon).toBe('fab fa-gitlab')
  })

  it('includes hostname for self-hosted instances', () => {
    const publisher = createGitLabPublisher({
      serverUrl: 'https://git.mycompany.com',
      clientId: 'test-id',
      serverBaseUrl: 'https://gib.show',
    })
    expect(publisher.name).toBe('GitLab (git.mycompany.com)')
  })

  it('starts unauthorized', () => {
    const publisher = createGitLabPublisher({
      clientId: 'test-id',
      serverBaseUrl: 'https://gib.show',
    })
    expect(publisher.isAuthorized()).toBe(false)
  })
})

describe('createGiteaPublisher', () => {
  it('creates a publisher with hostname in name', () => {
    const publisher = createGiteaPublisher({
      serverUrl: 'https://gitea.example.com',
    })
    expect(publisher.name).toBe('Gitea (gitea.example.com)')
    expect(publisher.icon).toBe('fas fa-code-branch')
  })

  it('starts unauthorized', () => {
    const publisher = createGiteaPublisher({
      serverUrl: 'https://gitea.example.com',
    })
    expect(publisher.isAuthorized()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Token storage (tested indirectly through isAuthorized / publisher interfaces)
// ---------------------------------------------------------------------------

describe('token storage — isAuthorized via seeded localStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('GitHub: isAuthorized returns true when a valid token is stored', () => {
    seedToken('github', 'ghp_valid')
    const publisher = createGitHubPublisher('https://gib.show')
    expect(publisher.isAuthorized()).toBe(true)
  })

  it('GitHub: isAuthorized returns false when token is expired (>30 days)', () => {
    seedExpiredToken('github', 'ghp_expired')
    const publisher = createGitHubPublisher('https://gib.show')
    expect(publisher.isAuthorized()).toBe(false)
  })

  it('GitHub: expired token is removed from localStorage', () => {
    seedExpiredToken('github', 'ghp_expired')
    const publisher = createGitHubPublisher('https://gib.show')
    publisher.isAuthorized() // triggers cleanup
    const stored = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '{}')
    expect(stored.github).toBeUndefined()
  })

  it('GitHub: isAuthorized returns true for legacy plain-string token (no TTL)', () => {
    seedLegacyToken('github', 'ghp_legacy')
    const publisher = createGitHubPublisher('https://gib.show')
    expect(publisher.isAuthorized()).toBe(true)
  })

  it('GitLab: isAuthorized returns true when a valid token is stored', () => {
    seedToken('gitlab', 'glpat_valid')
    const publisher = createGitLabPublisher({ clientId: 'cid', serverBaseUrl: 'https://gib.show' })
    expect(publisher.isAuthorized()).toBe(true)
  })

  it('GitLab: isAuthorized returns false when token is expired', () => {
    seedExpiredToken('gitlab', 'glpat_expired')
    const publisher = createGitLabPublisher({ clientId: 'cid', serverBaseUrl: 'https://gib.show' })
    expect(publisher.isAuthorized()).toBe(false)
  })

  it('GitLab: isAuthorized returns true for legacy plain-string token', () => {
    seedLegacyToken('gitlab', 'glpat_legacy')
    const publisher = createGitLabPublisher({ clientId: 'cid', serverBaseUrl: 'https://gib.show' })
    expect(publisher.isAuthorized()).toBe(true)
  })

  it('Gitea: isAuthorized returns true when a valid token is stored', () => {
    seedToken('gitea', 'gt_valid')
    const publisher = createGiteaPublisher({ serverUrl: 'https://gitea.example.com' })
    expect(publisher.isAuthorized()).toBe(true)
  })

  it('Gitea: isAuthorized returns false when token is expired', () => {
    seedExpiredToken('gitea', 'gt_expired')
    const publisher = createGiteaPublisher({ serverUrl: 'https://gitea.example.com' })
    expect(publisher.isAuthorized()).toBe(false)
  })

  it('Gitea: isAuthorized returns true for legacy plain-string token', () => {
    seedLegacyToken('gitea', 'gt_legacy')
    const publisher = createGiteaPublisher({ serverUrl: 'https://gitea.example.com' })
    expect(publisher.isAuthorized()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Publish methods
// ---------------------------------------------------------------------------

const makeList = (): import('./useLocalLists').LocalList => ({
  id: 'test-id',
  name: 'Test List',
  description: 'A test list',
  tokens: [{ chainId: 1, address: '0xabc', name: 'Token A', symbol: 'TKNA', decimals: 18, order: 0 }],
  source: { type: 'scratch' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('GitHub publish', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws when token is missing', async () => {
    const publisher = createGitHubPublisher('https://gib.show')
    await expect(publisher.publish(makeList(), {})).rejects.toThrow('Not authorized with GitHub')
  })

  it('throws when user fetch fails', async () => {
    seedToken('github', 'ghp_token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    const publisher = createGitHubPublisher('https://gib.show')
    await expect(publisher.publish(makeList(), {})).rejects.toThrow('GitHub auth failed')
  })

  it('creates repo (404) and pushes new file (no sha)', async () => {
    seedToken('github', 'ghp_token')

    const fetchMock = vi.fn()
      // /user
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ login: 'testuser' }) })
      // GET /repos/testuser/... → 404 (repo doesn't exist)
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // POST /user/repos (create)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ html_url: 'https://github.com/testuser/token-list-test-list' }) })
      // GET file contents → 404 (no existing file)
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // PUT file
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          commit: { html_url: 'https://github.com/testuser/token-list-test-list/commit/abc' },
          content: { html_url: 'https://github.com/testuser/token-list-test-list/blob/main/tokenlist.json' },
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const publisher = createGitHubPublisher('https://gib.show')
    const result = await publisher.publish(makeList(), {})

    expect(result.repoUrl).toBe('https://github.com/testuser/token-list-test-list')
    expect(result.commitUrl).toBe('https://github.com/testuser/token-list-test-list/commit/abc')
    expect(result.fileUrl).toBe('https://github.com/testuser/token-list-test-list/blob/main/tokenlist.json')
  })

  it('updates existing repo and file (has sha)', async () => {
    seedToken('github', 'ghp_token')

    const fetchMock = vi.fn()
      // /user
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ login: 'testuser' }) })
      // GET /repos/testuser/... → ok (existing repo)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ html_url: 'https://github.com/testuser/my-repo' }) })
      // GET file contents → ok (existing file with sha)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'existing-sha-123' }) })
      // PUT file
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          commit: { html_url: 'https://github.com/testuser/my-repo/commit/def' },
          content: { html_url: 'https://github.com/testuser/my-repo/blob/main/tokenlist.json' },
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const publisher = createGitHubPublisher('https://gib.show')
    const result = await publisher.publish(makeList(), { repoName: 'my-repo' })

    expect(result.repoUrl).toBe('https://github.com/testuser/my-repo')
    expect(result.commitUrl).toBe('https://github.com/testuser/my-repo/commit/def')

    // Verify the PUT body included the sha
    const putCall = fetchMock.mock.calls[3]
    const putBody = JSON.parse(putCall[1].body)
    expect(putBody.sha).toBe('existing-sha-123')
  })
})

describe('GitLab publish', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws when token is missing', async () => {
    const publisher = createGitLabPublisher({ clientId: 'cid', serverBaseUrl: 'https://gib.show' })
    await expect(publisher.publish(makeList(), {})).rejects.toThrow('Not authorized with GitLab')
  })

  it('throws when not authorized (user fetch fails)', async () => {
    seedToken('gitlab', 'glpat_token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    const publisher = createGitLabPublisher({ clientId: 'cid', serverBaseUrl: 'https://gib.show' })
    await expect(publisher.publish(makeList(), {})).rejects.toThrow('GitLab auth failed')
  })

  it('creates project (404) and pushes new file (POST)', async () => {
    seedToken('gitlab', 'glpat_token')

    const fetchMock = vi.fn()
      // GET /user
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ username: 'gluser' }) })
      // GET /projects/:path → 404
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // POST /projects (create)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ web_url: 'https://gitlab.com/gluser/token-list-test-list' }) })
      // GET file contents → 404 (no existing file)
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // POST file
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })

    vi.stubGlobal('fetch', fetchMock)

    const publisher = createGitLabPublisher({ clientId: 'cid', serverBaseUrl: 'https://gib.show' })
    const result = await publisher.publish(makeList(), {})

    expect(result.repoUrl).toBe('https://gitlab.com/gluser/token-list-test-list')
    expect(result.fileUrl).toBe('https://gitlab.com/gluser/token-list-test-list/-/blob/main/tokenlist.json')

    // File was created via POST
    const fileCall = fetchMock.mock.calls[4]
    expect(fileCall[1].method).toBe('POST')
  })

  it('updates existing file (PUT) when file already exists', async () => {
    seedToken('gitlab', 'glpat_token')

    const fetchMock = vi.fn()
      // GET /user
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ username: 'gluser' }) })
      // GET /projects/:path → ok (existing project)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ web_url: 'https://gitlab.com/gluser/my-project' }) })
      // GET file contents → ok (existing file)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ content: 'base64content' }) })
      // PUT file
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })

    vi.stubGlobal('fetch', fetchMock)

    const publisher = createGitLabPublisher({ clientId: 'cid', serverBaseUrl: 'https://gib.show' })
    const result = await publisher.publish(makeList(), { repoName: 'my-project' })

    expect(result.repoUrl).toBe('https://gitlab.com/gluser/my-project')

    // File was updated via PUT
    const fileCall = fetchMock.mock.calls[3]
    expect(fileCall[1].method).toBe('PUT')
  })
})

describe('Gitea publish', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws when token is missing', async () => {
    const publisher = createGiteaPublisher({ serverUrl: 'https://gitea.example.com' })
    await expect(publisher.publish(makeList(), {})).rejects.toThrow('Not authorized with Gitea')
  })

  it('throws when not authorized (user fetch fails)', async () => {
    seedToken('gitea', 'gt_token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    const publisher = createGiteaPublisher({ serverUrl: 'https://gitea.example.com' })
    await expect(publisher.publish(makeList(), {})).rejects.toThrow('Gitea auth failed')
  })

  it('creates repo (404) and pushes new file (POST)', async () => {
    seedToken('gitea', 'gt_token')

    const fetchMock = vi.fn()
      // GET /user
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ login: 'gtuser' }) })
      // GET /repos/gtuser/... → 404
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // POST /user/repos (create)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ html_url: 'https://gitea.example.com/gtuser/token-list-test-list' }) })
      // GET file contents → 404 (no existing file, so no sha)
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // POST file (no sha → POST)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: { html_url: 'https://gitea.example.com/gtuser/token-list-test-list/raw/branch/main/tokenlist.json' } }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const publisher = createGiteaPublisher({ serverUrl: 'https://gitea.example.com' })
    const result = await publisher.publish(makeList(), {})

    expect(result.repoUrl).toBe('https://gitea.example.com/gtuser/token-list-test-list')
    expect(result.fileUrl).toBe('https://gitea.example.com/gtuser/token-list-test-list/raw/branch/main/tokenlist.json')

    // No sha means POST
    const fileCall = fetchMock.mock.calls[4]
    expect(fileCall[1].method).toBe('POST')
  })

  it('updates existing repo and file (PUT with sha)', async () => {
    seedToken('gitea', 'gt_token')

    const fetchMock = vi.fn()
      // GET /user
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ login: 'gtuser' }) })
      // GET /repos/gtuser/my-repo → ok
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ html_url: 'https://gitea.example.com/gtuser/my-repo' }) })
      // GET file contents → ok (returns sha)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'file-sha-xyz' }) })
      // PUT file
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: { html_url: 'https://gitea.example.com/gtuser/my-repo/raw/branch/main/tokenlist.json' } }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const publisher = createGiteaPublisher({ serverUrl: 'https://gitea.example.com' })
    const result = await publisher.publish(makeList(), { repoName: 'my-repo' })

    expect(result.repoUrl).toBe('https://gitea.example.com/gtuser/my-repo')

    // Has sha → PUT
    const fileCall = fetchMock.mock.calls[3]
    expect(fileCall[1].method).toBe('PUT')
    const putBody = JSON.parse(fileCall[1].body)
    expect(putBody.sha).toBe('file-sha-xyz')
  })
})

describe('Gitea storeToken via authorize() (personal access token path)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('prompt', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores token in localStorage after personal-access-token authorize', async () => {
    vi.mocked(prompt).mockReturnValue('my-gitea-pat')
    const publisher = createGiteaPublisher({ serverUrl: 'https://gitea.example.com' })

    await publisher.authorize()

    const stored = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '{}')
    expect(stored.gitea?.token).toBe('my-gitea-pat')
    expect(typeof stored.gitea?.storedAt).toBe('number')
  })

  it('throws when personal-access-token prompt is cancelled', async () => {
    vi.mocked(prompt).mockReturnValue(null)
    const publisher = createGiteaPublisher({ serverUrl: 'https://gitea.example.com' })

    await expect(publisher.authorize()).rejects.toThrow('Authorization cancelled')
  })
})

// ---------------------------------------------------------------------------
// handleOAuthCallback
// ---------------------------------------------------------------------------

describe('handleOAuthCallback', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    // Stub history.replaceState so the async fetch side-effect doesn't throw
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns false when there are no query params', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '' },
      writable: true,
    })
    const result = handleOAuthCallback('https://gib.show')
    expect(result).toBe(false)
  })

  it('returns false when code param is missing', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?state=abc123' },
      writable: true,
    })
    const result = handleOAuthCallback('https://gib.show')
    expect(result).toBe(false)
  })

  it('returns false when state param is missing', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?code=mycode' },
      writable: true,
    })
    const result = handleOAuthCallback('https://gib.show')
    expect(result).toBe(false)
  })

  it('returns false when state does not match any stored session state', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?code=mycode&state=unknown-state' },
      writable: true,
    })
    // No session storage entry — state mismatch
    const result = handleOAuthCallback('https://gib.show')
    expect(result).toBe(false)
  })

  it('returns true and clears session state when GitHub state matches', () => {
    const state = 'github-test-state-xyz'
    sessionStorage.setItem('github-oauth-state', state)

    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        search: `?code=mycode&state=${state}`,
        pathname: '/callback',
        hash: '',
      },
      writable: true,
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ access_token: 'ghp_from_server' }),
    }))

    const result = handleOAuthCallback('https://gib.show')
    expect(result).toBe(true)
    // Session state must be cleaned up immediately (before async exchange completes)
    expect(sessionStorage.getItem('github-oauth-state')).toBeNull()
  })

  it('returns true and clears session state when GitLab state matches', () => {
    const state = 'gitlab-test-state-abc'
    sessionStorage.setItem('gitlab-oauth-state', state)

    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        search: `?code=mycode&state=${state}`,
        pathname: '/callback',
        hash: '',
      },
      writable: true,
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ access_token: 'glpat_from_server' }),
    }))

    const result = handleOAuthCallback('https://gib.show')
    expect(result).toBe(true)
    expect(sessionStorage.getItem('gitlab-oauth-state')).toBeNull()
  })

  it('returns true and clears session state when Gitea state matches', () => {
    const state = 'gitea-test-state-def'
    sessionStorage.setItem('gitea-oauth-state', state)

    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        search: `?code=mycode&state=${state}`,
        pathname: '/callback',
        hash: '',
      },
      writable: true,
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ access_token: 'gt_from_server' }),
    }))

    const result = handleOAuthCallback('https://gib.show')
    expect(result).toBe(true)
    expect(sessionStorage.getItem('gitea-oauth-state')).toBeNull()
  })
})
