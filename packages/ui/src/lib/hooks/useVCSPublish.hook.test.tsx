/**
 * Component-level tests for the useVCSPublish hook and authorize() methods.
 * Kept in a .tsx file because renderHook requires the React JSX transform.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useVCSPublish,
  createGitHubPublisher,
  createGitLabPublisher,
  createGiteaPublisher,
} from './useVCSPublish'
import type { VCSPublisher, PublishResult } from './useVCSPublish'
import type { LocalList } from './useLocalLists'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN_STORAGE_KEY = 'gib-vcs-tokens'

function seedToken(provider: string, token: string, storedAt = Date.now()): void {
  const existing = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '{}')
  existing[provider] = { token, storedAt }
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(existing))
}

const makeList = (): LocalList => ({
  id: 'test-id',
  name: 'Test List',
  description: 'A test list',
  tokens: [{ chainId: 1, address: '0xabc', name: 'Token A', symbol: 'TKNA', decimals: 18, order: 0 }],
  source: { type: 'scratch' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

/** Build a fully-authorized mock VCSPublisher */
function makeMockPublisher(overrides: Partial<VCSPublisher> = {}): VCSPublisher {
  return {
    name: 'MockVCS',
    icon: 'fas fa-mock',
    isAuthorized: vi.fn().mockReturnValue(true),
    authorize: vi.fn().mockResolvedValue('mock-token'),
    publish: vi.fn().mockResolvedValue({
      repoUrl: 'https://mock.vcs/repo',
      commitUrl: 'https://mock.vcs/commit/abc',
      fileUrl: 'https://mock.vcs/file',
    } satisfies PublishResult),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// useVCSPublish hook — initial state
// ---------------------------------------------------------------------------

describe('useVCSPublish hook', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns initial state with isPublishing=false, publishResult=null, error=null', () => {
    const { result } = renderHook(() => useVCSPublish())
    expect(result.current.isPublishing).toBe(false)
    expect(result.current.publishResult).toBeNull()
    expect(result.current.error).toBeNull()
    expect(typeof result.current.publish).toBe('function')
  })

  // -------------------------------------------------------------------------
  // publish() — authorized publisher path
  // -------------------------------------------------------------------------

  it('sets isPublishing to true during publish and resets to false after', async () => {
    let resolvePublish!: (result: PublishResult) => void
    const pendingPublish = new Promise<PublishResult>((res) => { resolvePublish = res })

    const publisher = makeMockPublisher({
      publish: vi.fn().mockReturnValue(pendingPublish),
    })

    const { result } = renderHook(() => useVCSPublish())

    // Start publishing (don't await)
    act(() => {
      void result.current.publish(publisher, makeList())
    })

    expect(result.current.isPublishing).toBe(true)

    // Resolve the publish
    await act(async () => {
      resolvePublish({ repoUrl: 'https://mock.vcs/repo' })
      await pendingPublish
    })

    expect(result.current.isPublishing).toBe(false)
  })

  it('sets publishResult when publisher.publish succeeds', async () => {
    const publisher = makeMockPublisher()
    const { result } = renderHook(() => useVCSPublish())

    await act(async () => {
      await result.current.publish(publisher, makeList())
    })

    expect(result.current.publishResult).toEqual({
      repoUrl: 'https://mock.vcs/repo',
      commitUrl: 'https://mock.vcs/commit/abc',
      fileUrl: 'https://mock.vcs/file',
    })
    expect(result.current.error).toBeNull()
    expect(result.current.isPublishing).toBe(false)
  })

  it('publish() returns the result from publisher.publish', async () => {
    const publisher = makeMockPublisher()
    const { result } = renderHook(() => useVCSPublish())

    let returnValue: PublishResult | undefined
    await act(async () => {
      returnValue = await result.current.publish(publisher, makeList())
    })

    expect(returnValue).toEqual({
      repoUrl: 'https://mock.vcs/repo',
      commitUrl: 'https://mock.vcs/commit/abc',
      fileUrl: 'https://mock.vcs/file',
    })
  })

  // -------------------------------------------------------------------------
  // publish() — unauthorized publisher calls authorize and returns early
  // -------------------------------------------------------------------------

  it('calls authorize() and returns early (without setting publishResult) when not authorized', async () => {
    const publisher = makeMockPublisher({
      isAuthorized: vi.fn().mockReturnValue(false),
      authorize: vi.fn().mockResolvedValue(''),
    })

    const { result } = renderHook(() => useVCSPublish())

    await act(async () => {
      await result.current.publish(publisher, makeList())
    })

    expect(publisher.authorize).toHaveBeenCalledOnce()
    expect(publisher.publish).not.toHaveBeenCalled()
    expect(result.current.publishResult).toBeNull()
    expect(result.current.isPublishing).toBe(false)
  })

  // -------------------------------------------------------------------------
  // publish() — error path
  // -------------------------------------------------------------------------

  it('sets error and resets isPublishing when publisher.publish throws', async () => {
    const publisher = makeMockPublisher({
      publish: vi.fn().mockRejectedValue(new Error('Network failure')),
    })

    const { result } = renderHook(() => useVCSPublish())

    await act(async () => {
      await result.current.publish(publisher, makeList())
    })

    expect(result.current.error).toBe('Network failure')
    expect(result.current.publishResult).toBeNull()
    expect(result.current.isPublishing).toBe(false)
  })

  it('clears previous error on new publish attempt', async () => {
    const publisher = makeMockPublisher({
      publish: vi.fn()
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce({ repoUrl: 'https://mock.vcs/repo' }),
    })

    const { result } = renderHook(() => useVCSPublish())

    // First attempt fails
    await act(async () => {
      await result.current.publish(publisher, makeList())
    })
    expect(result.current.error).toBe('First error')

    // Second attempt succeeds and clears error
    await act(async () => {
      await result.current.publish(publisher, makeList())
    })
    expect(result.current.error).toBeNull()
    expect(result.current.publishResult).toEqual({ repoUrl: 'https://mock.vcs/repo' })
  })

  it('passes PublishOptions to publisher.publish', async () => {
    const publisher = makeMockPublisher()
    const { result } = renderHook(() => useVCSPublish())

    const options = { repoName: 'my-custom-repo', branch: 'develop' }

    await act(async () => {
      await result.current.publish(publisher, makeList(), options)
    })

    expect(publisher.publish).toHaveBeenCalledWith(makeList(), options)
  })
})

// ---------------------------------------------------------------------------
// GitHub authorize() — sets sessionStorage and redirects
// ---------------------------------------------------------------------------

describe('GitHub authorize()', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => 'mock-uuid-1234' })
    Object.defineProperty(window, 'location', {
      value: {
        href: '',
        origin: 'http://localhost',
        pathname: '/',
      },
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets github-oauth-state in sessionStorage', async () => {
    const publisher = createGitHubPublisher('https://gib.show')
    // authorize() redirects (sets window.location.href) and returns ''
    await publisher.authorize()
    expect(sessionStorage.getItem('github-oauth-state')).toBe('mock-uuid-1234')
  })

  it('redirects to GitHub OAuth URL with correct params', async () => {
    const publisher = createGitHubPublisher('https://gib.show')
    await publisher.authorize()

    const href = (window.location as { href: string }).href
    expect(href).toContain('https://github.com/login/oauth/authorize')
    expect(href).toContain('scope=public_repo')
    expect(href).toContain('state=mock-uuid-1234')
    expect(href).toContain('redirect_uri=')
  })

  it('uses crypto.randomUUID for state', async () => {
    const randomUUID = vi.fn().mockReturnValue('unique-state-xyz')
    vi.stubGlobal('crypto', { randomUUID })

    const publisher = createGitHubPublisher('https://gib.show')
    await publisher.authorize()

    expect(randomUUID).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem('github-oauth-state')).toBe('unique-state-xyz')
  })
})

// ---------------------------------------------------------------------------
// GitLab authorize() — sets sessionStorage and redirects
// ---------------------------------------------------------------------------

describe('GitLab authorize()', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => 'mock-uuid-1234' })
    Object.defineProperty(window, 'location', {
      value: {
        href: '',
        origin: 'http://localhost',
        pathname: '/',
      },
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets gitlab-oauth-state in sessionStorage', async () => {
    const publisher = createGitLabPublisher({ clientId: 'gl-client-id', serverBaseUrl: 'https://gib.show' })
    await publisher.authorize()
    expect(sessionStorage.getItem('gitlab-oauth-state')).toBe('mock-uuid-1234')
  })

  it('redirects to GitLab OAuth URL with correct params', async () => {
    const publisher = createGitLabPublisher({ clientId: 'gl-client-id', serverBaseUrl: 'https://gib.show' })
    await publisher.authorize()

    const href = (window.location as { href: string }).href
    expect(href).toContain('https://gitlab.com/oauth/authorize')
    expect(href).toContain('client_id=gl-client-id')
    expect(href).toContain('scope=api')
    expect(href).toContain('state=mock-uuid-1234')
    expect(href).toContain('response_type=code')
  })

  it('uses the custom serverUrl for self-hosted GitLab', async () => {
    const publisher = createGitLabPublisher({
      serverUrl: 'https://git.mycompany.com',
      clientId: 'company-client-id',
      serverBaseUrl: 'https://gib.show',
    })
    await publisher.authorize()

    const href = (window.location as { href: string }).href
    expect(href).toContain('https://git.mycompany.com/oauth/authorize')
    expect(href).toContain('client_id=company-client-id')
  })

  it('uses crypto.randomUUID for state', async () => {
    const randomUUID = vi.fn().mockReturnValue('gitlab-state-abc')
    vi.stubGlobal('crypto', { randomUUID })

    const publisher = createGitLabPublisher({ clientId: 'cid', serverBaseUrl: 'https://gib.show' })
    await publisher.authorize()

    expect(randomUUID).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem('gitlab-oauth-state')).toBe('gitlab-state-abc')
  })
})

// ---------------------------------------------------------------------------
// Gitea OAuth authorize() — sets sessionStorage and redirects (with clientId)
// ---------------------------------------------------------------------------

describe('Gitea OAuth authorize() (with clientId)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => 'mock-uuid-1234' })
    Object.defineProperty(window, 'location', {
      value: {
        href: '',
        origin: 'http://localhost',
        pathname: '/',
      },
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets gitea-oauth-state in sessionStorage', async () => {
    const publisher = createGiteaPublisher({
      serverUrl: 'https://gitea.example.com',
      clientId: 'gitea-client-id',
    })
    await publisher.authorize()
    expect(sessionStorage.getItem('gitea-oauth-state')).toBe('mock-uuid-1234')
  })

  it('redirects to Gitea OAuth URL with correct params', async () => {
    const publisher = createGiteaPublisher({
      serverUrl: 'https://gitea.example.com',
      clientId: 'gitea-client-id',
    })
    await publisher.authorize()

    const href = (window.location as { href: string }).href
    expect(href).toContain('https://gitea.example.com/login/oauth/authorize')
    expect(href).toContain('client_id=gitea-client-id')
    expect(href).toContain('scope=repo')
    expect(href).toContain('state=mock-uuid-1234')
    expect(href).toContain('response_type=code')
  })

  it('uses crypto.randomUUID for state', async () => {
    const randomUUID = vi.fn().mockReturnValue('gitea-state-def')
    vi.stubGlobal('crypto', { randomUUID })

    const publisher = createGiteaPublisher({
      serverUrl: 'https://gitea.example.com',
      clientId: 'gitea-client-id',
    })
    await publisher.authorize()

    expect(randomUUID).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem('gitea-oauth-state')).toBe('gitea-state-def')
  })
})

// ---------------------------------------------------------------------------
// Gitea API error line (line 389)
// ---------------------------------------------------------------------------

describe('Gitea publish API error', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws on non-404 Gitea API error when fetching repo', async () => {
    seedToken('gitea', 'gt_token')

    const fetchMock = vi.fn()
      // GET /user — success
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ login: 'gtuser' }) })
      // GET /repos/gtuser/... → 500 server error (not 404, not ok)
      .mockResolvedValueOnce({ ok: false, status: 500 })

    vi.stubGlobal('fetch', fetchMock)

    const publisher = createGiteaPublisher({ serverUrl: 'https://gitea.example.com' })
    await expect(publisher.publish(makeList(), {})).rejects.toThrow('Gitea API error: 500')
  })
})

// ---------------------------------------------------------------------------
// GitHub API error (non-404 on repo fetch) — line 151
// ---------------------------------------------------------------------------

describe('GitHub publish API error', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws on non-404 GitHub API error when fetching repo', async () => {
    seedToken('github', 'ghp_token')

    const fetchMock = vi.fn()
      // GET /user — success
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ login: 'testuser' }) })
      // GET /repos/testuser/... → 500 (not 404, not ok)
      .mockResolvedValueOnce({ ok: false, status: 500 })

    vi.stubGlobal('fetch', fetchMock)

    const publisher = createGitHubPublisher('https://gib.show')
    await expect(publisher.publish(makeList(), {})).rejects.toThrow('GitHub API error: 500')
  })
})

// ---------------------------------------------------------------------------
// GitLab API error (non-404 on project fetch) — line 268
// ---------------------------------------------------------------------------

describe('GitLab publish API error', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws on non-404 GitLab API error when fetching project', async () => {
    seedToken('gitlab', 'glpat_token')

    const fetchMock = vi.fn()
      // GET /user — success
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ username: 'gluser' }) })
      // GET /projects/:path → 403 (not 404, not ok)
      .mockResolvedValueOnce({ ok: false, status: 403 })

    vi.stubGlobal('fetch', fetchMock)

    const publisher = createGitLabPublisher({ clientId: 'cid', serverBaseUrl: 'https://gib.show' })
    await expect(publisher.publish(makeList(), {})).rejects.toThrow('GitLab API error: 403')
  })
})

// ---------------------------------------------------------------------------
// getStoredTokens JSON parse error (line 60 catch branch)
// ---------------------------------------------------------------------------

describe('getStoredTokens catch branch', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('returns empty object when localStorage contains invalid JSON', () => {
    // Seed corrupt JSON directly into localStorage
    localStorage.setItem('gib-vcs-tokens', 'this-is-not-json{{{')

    // isAuthorized() internally calls getStoredTokens() → JSON.parse throws → returns {}
    const publisher = createGitHubPublisher('https://gib.show')
    expect(publisher.isAuthorized()).toBe(false)
  })
})
