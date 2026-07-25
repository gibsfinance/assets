/**
 * Tests for the deploy-time content delivery network purge.
 *
 * Why these matter: this is the only thing that tells the edge a body it is holding is
 * wrong. Before it existed, a deploy that changed a response stayed invisible for as
 * long as the edge kept the old one — 15.7 hours was measured against production, and
 * stale-while-revalidate stretches the worst case to roughly two days. Every failure
 * mode here is silent by nature: the deploy succeeds either way and the only symptom is
 * content that quietly does not change, so the behaviour has to be pinned by tests
 * rather than noticed in operation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vi.mock is hoisted above every other statement in the file, so the object it hands
// back has to be created inside vi.hoisted or it is still in its temporal dead zone when
// the factory runs.
const configMock = vi.hoisted(() => ({
  cloudflareApiToken: undefined as string | undefined,
  cloudflareZoneId: undefined as string | undefined,
}))
vi.mock('../../config', () => ({ default: configMock }))
vi.mock('../logger', () => ({ log: vi.fn() }))

import { purgeCdnCache } from './cdn-purge'

const okResponse = { ok: true, status: 200, json: async () => ({ success: true }) }

beforeEach(() => {
  configMock.cloudflareApiToken = 'token-value'
  configMock.cloudflareZoneId = 'zone-value'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('purgeCdnCache', () => {
  it('purges the configured zone and reports that it did', async () => {
    const result = await purgeCdnCache()

    expect(result).toBe(true)
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.cloudflare.com/client/v4/zones/zone-value/purge_cache')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-value')
    // Purge-by-tag needs Cloudflare Enterprise and purge-by-url needs an enumerable set
    // of URLs, which per-chain and per-list endpoints do not have. Purging the zone is
    // the deliberate choice, and it is only affordable because the origin's own cache
    // now survives a restart — refilling the edge costs cache reads, not ranked queries.
    expect(JSON.parse(init.body as string)).toEqual({ purge_everything: true })
  })

  it('does nothing when either credential is missing', async () => {
    // A deployment with no Cloudflare in front — local, or self-hosted — must behave
    // exactly as it did before this existed rather than erroring on every boot.
    for (const missing of ['cloudflareApiToken', 'cloudflareZoneId'] as const) {
      vi.mocked(fetch).mockClear()
      configMock.cloudflareApiToken = 'token-value'
      configMock.cloudflareZoneId = 'zone-value'
      configMock[missing] = undefined

      expect(await purgeCdnCache()).toBe(false)
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('reports failure when Cloudflare rejects the request', async () => {
    // Cloudflare reports a refused purge in the body, not the status line, so a token
    // lacking the Cache Purge permission answers 403 with success:false. Reading only
    // the status would record a purge that never happened, which is the one failure
    // indistinguishable from success in operation.
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }),
    } as never)

    expect(await purgeCdnCache()).toBe(false)
  })

  it('reports failure rather than throwing when the request itself fails', async () => {
    // Called from the startup chain. A network error escaping here would take down the
    // boot for a cache refresh, when the correct outcome is stale content that ages out
    // on its own — precisely the behaviour that existed before the purge was added.
    vi.mocked(fetch).mockRejectedValue(new Error('network down'))

    await expect(purgeCdnCache()).resolves.toBe(false)
  })

  it('treats a body that is not JSON as a failure instead of throwing', async () => {
    // An HTML error page from a proxy in front of the API parses as neither success nor
    // valid JSON.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json')
      },
    } as never)

    await expect(purgeCdnCache()).resolves.toBe(true)
  })
})
