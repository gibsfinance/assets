import { afterEach, describe, expect, it } from 'vitest'
import { createMockFetch, findMockRoute, installMockApi } from './mock-api'
import type { MockApiRoutes } from './mock-api'

const ROUTES: MockApiRoutes = {
  '/networks': { kind: 'json', body: [{ name: 'A' }], headers: { 'x-cache': 'HIT' } },
  '/broken': { kind: 'json', status: 500, body: { error: 'boom' } },
  '/slow': { kind: 'never' },
}

describe('findMockRoute', () => {
  it('finds a listed path and nothing for an unlisted one', () => {
    expect(findMockRoute(ROUTES, '/networks')?.kind).toBe('json')
    expect(findMockRoute(ROUTES, '/other')).toBeUndefined()
  })

  it('does not treat an inherited property name as a route', () => {
    expect(findMockRoute(ROUTES, 'toString')).toBeUndefined()
  })
})

describe('createMockFetch', () => {
  const mockFetch = createMockFetch(ROUTES, 'http://localhost/page')

  it('answers a listed path with its body, status and extra headers', async () => {
    const response = await mockFetch('/networks?x=1')
    expect(response.status).toBe(200)
    expect(response.headers.get('x-cache')).toBe('HIT')
    expect(await response.json()).toEqual([{ name: 'A' }])
  })

  it('answers with the route status', async () => {
    expect((await mockFetch('http://elsewhere.test/broken')).status).toBe(500)
  })

  it('reads the address from a Request object', async () => {
    expect((await mockFetch(new Request('http://localhost/networks'))).status).toBe(200)
  })

  it('answers 404 for a path no fixture lists, rather than reaching a network', async () => {
    const response = await mockFetch('/unknown')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No fixture for this path' })
  })

  it('never answers a "never" route, and rejects when the request is aborted', async () => {
    const controller = new AbortController()
    const pending = mockFetch('/slow', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('leaves a "never" route pending when the request has no signal', () => {
    expect(mockFetch('/slow')).toBeInstanceOf(Promise)
  })
})

describe('installMockApi', () => {
  const realFetch = window.fetch

  afterEach(() => {
    window.fetch = realFetch
  })

  it('changes nothing when a story has no routes', () => {
    installMockApi(undefined)()
    expect(window.fetch).toBe(realFetch)
  })

  it('replaces fetch while installed and restores it afterward', async () => {
    const restore = installMockApi(ROUTES)
    expect(window.fetch).not.toBe(realFetch)
    expect((await window.fetch('/networks')).status).toBe(200)
    restore()
    expect(window.fetch).toBe(realFetch)
  })
})
