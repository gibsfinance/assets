import { beforeEach, describe, expect, it, vi } from 'vitest'

const { configuredDomains } = vi.hoisted(() => ({
  configuredDomains: ['https://gateway-a.example/', 'https://gateway-b.example/'],
}))
vi.mock('./args/ipfs', () => ({ ipfs: () => ({ ipfs: configuredDomains }) }))

const ipfsFetch = vi.fn(async (..._args: unknown[]) => new Response('ok'))
vi.mock('@gibs/utils/fetch', () => ({ fetch: (...args: unknown[]) => ipfsFetch(...args) }))

import { fetch } from './fetch'

describe('fetch (ipfs-compatible wrapper)', () => {
  beforeEach(() => {
    ipfsFetch.mockClear()
  })

  it('forwards the configured ipfs gateways and a spoofed desktop user agent when no options are given', async () => {
    await fetch('ipfs://QmExample/logo.png')

    expect(ipfsFetch).toHaveBeenCalledTimes(1)
    const [url, opts, domains] = ipfsFetch.mock.calls[0]
    expect(url).toBe('ipfs://QmExample/logo.png')
    // The user agent exists to bypass servers that block bare Node/undici
    // requests; the exact string is an implementation detail, but it must look
    // like a real desktop browser or the bypass silently stops working.
    expect((opts as unknown as { headers: Record<string, string> }).headers['User-Agent']).toMatch(/Mozilla.*Chrome/)
    // The ipfs domain list comes from args/ipfs — this wrapper's whole job is to
    // wire that configuration into every call without the caller repeating it.
    expect(domains).toBe(configuredDomains)
  })

  it('merges caller-supplied headers over the default user agent', async () => {
    await fetch('https://example.com/logo.png', { headers: { Accept: 'image/png', 'User-Agent': 'custom-agent' } })

    const [, opts] = ipfsFetch.mock.calls[0]
    const headers = (opts as unknown as { headers: Record<string, string> }).headers
    // Caller headers are spread in after the default, so an explicit override
    // (as a caller might set for a picky origin) must win rather than being
    // silently clobbered by the bypass user agent.
    expect(headers['User-Agent']).toBe('custom-agent')
    expect(headers.Accept).toBe('image/png')
  })
})
