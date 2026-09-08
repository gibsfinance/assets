import { describe, it, expect, vi } from 'vitest'

// Deterministic submodules root so relative-path assertions don't depend on
// where this checkout happens to live on disk.
vi.mock('../../paths', () => ({ submodules: '/submodules' }))

import { sourceKeyFromUri, resolveAttribution, attributionHeaders, ATTRIBUTION_HEADER_NAMES } from './attribution'

describe('sourceKeyFromUri', () => {
  it('returns null for a falsy uri', () => {
    expect(sourceKeyFromUri('')).toBeNull()
  })

  it('returns the hostname for an http uri', () => {
    expect(sourceKeyFromUri('http://raw.githubusercontent.com/foo/bar.png')).toBe('raw.githubusercontent.com')
  })

  it('returns the hostname for an https uri', () => {
    expect(sourceKeyFromUri('https://cdn.example.com/foo/bar.png')).toBe('cdn.example.com')
  })

  it('returns null when an http(s)-prefixed value fails to parse as a URL', () => {
    // Contains a space, which the WHATWG URL parser rejects.
    expect(sourceKeyFromUri('https://not a valid url')).toBeNull()
  })

  it('returns null for an ipfs uri', () => {
    expect(sourceKeyFromUri('ipfs://QmSomeCid')).toBeNull()
  })

  it('returns null for a data uri', () => {
    expect(sourceKeyFromUri('data:image/png;base64,abc')).toBeNull()
  })

  it('returns the first path segment for a relative submodule path', () => {
    expect(sourceKeyFromUri('smoldapp-tokenassets/chains/1/logo.svg')).toBe('smoldapp-tokenassets')
  })

  it('returns the whole value when it has no path separator', () => {
    expect(sourceKeyFromUri('trustwallet')).toBe('trustwallet')
  })

  it('returns null when the first segment is empty (leading slash)', () => {
    expect(sourceKeyFromUri('/chains/1/logo.svg')).toBeNull()
  })
})

describe('resolveAttribution', () => {
  it('resolves a known provider key directly', () => {
    const source = resolveAttribution({ providerKey: 'trustwallet' })
    expect(source.sourceKey).toBe('trustwallet')
    expect(source.license).toBe('MIT')
  })

  it('resolves the smoldapp provider key and its submodule-directory alias to the same entry', () => {
    const byProviderKey = resolveAttribution({ providerKey: 'smoldapp' })
    const byUri = resolveAttribution({ uri: 'smoldapp-tokenassets/chains/1/logo.svg' })
    expect(byProviderKey.sourceKey).toBe('smoldapp')
    expect(byUri.sourceKey).toBe('smoldapp')
    expect(byProviderKey).toEqual(byUri)
  })

  it('resolves the ethereum-lists provider key and its submodule-directory alias to the same entry', () => {
    const byProviderKey = resolveAttribution({ providerKey: 'ethereum-lists' })
    const byUri = resolveAttribution({ uri: '/submodules/ethereum-lists-tokens/tokens/eth/0xabc.json' })
    expect(byProviderKey.sourceKey).toBe('ethereum-lists')
    expect(byUri.sourceKey).toBe('ethereum-lists')
    expect(byUri.license).toBe('MIT')
  })

  it('resolves pls369 to an unverified licence even though the source is identifiable', () => {
    const byProviderKey = resolveAttribution({ providerKey: 'pls369' })
    const byUri = resolveAttribution({
      uri: '/submodules/pulsechain-assets/blockchain/pulsechain/assets/0xabc/logo.png',
    })
    expect(byProviderKey.sourceKey).toBe('pls369')
    expect(byProviderKey.license).toBe('unknown')
    expect(byUri.sourceKey).toBe('pls369')
    expect(byUri.license).toBe('unknown')
    // The README URL is retained as evidence even though no licence was granted.
    expect(byProviderKey.licenseUrl).toBe('https://github.com/PLS369/pulsechain-assets/blob/main/README.md')
  })

  it('falls back to the uri-derived key when the provider key is unrecognized', () => {
    const source = resolveAttribution({
      providerKey: 'some-unregistered-provider',
      uri: 'trustwallet/blockchains/1/logo.png',
    })
    expect(source.sourceKey).toBe('trustwallet')
  })

  it('falls back to the unknown entry when neither provider key nor uri resolve', () => {
    const source = resolveAttribution({ providerKey: 'gibs', uri: 'https://cdn.unrelated-host.example/logo.png' })
    expect(source.sourceKey).toBe('unknown')
    expect(source.license).toBe('unknown')
    expect(source.licenseUrl).toBeNull()
    expect(source.attribution).toBeNull()
  })

  it('falls back to the unknown entry when given neither a provider key nor a uri', () => {
    const source = resolveAttribution({})
    expect(source.sourceKey).toBe('unknown')
  })

  it('treats an empty-string provider key as absent', () => {
    const source = resolveAttribution({ providerKey: '', uri: 'trustwallet/blockchains/1/logo.png' })
    expect(source.sourceKey).toBe('trustwallet')
  })
})

describe('attributionHeaders', () => {
  it('always includes the licence-terms link and x-license', () => {
    const headers = attributionHeaders({})
    expect(headers.link).toBe('<https://gib.show/terms>; rel="license"')
    expect(headers['x-license']).toBe('unknown')
  })

  it('sets x-source-uri and the backwards-compatible x-uri alias to the same value', () => {
    const headers = attributionHeaders({ uri: 'https://cdn.example.com/logo.png' })
    expect(headers['x-source-uri']).toBe('https://cdn.example.com/logo.png')
    expect(headers['x-uri']).toBe('https://cdn.example.com/logo.png')
  })

  it('normalizes an absolute submodule filesystem path before exposing it', () => {
    const headers = attributionHeaders({ uri: '/submodules/smoldapp-tokenassets/chains/1/logo.svg' })
    expect(headers['x-source-uri']).toBe('smoldapp-tokenassets/chains/1/logo.svg')
    expect(headers['x-uri']).toBe('smoldapp-tokenassets/chains/1/logo.svg')
    expect(headers['x-provider']).toBe('smoldapp')
    expect(headers['x-provider-name']).toBe('Smol')
    expect(headers['x-license']).toBe('MIT')
    expect(headers['x-license-url']).toBe('https://github.com/SmolDapp/tokenAssets/blob/main/LICENSE')
    expect(headers['x-attribution']).toBe('Copyright (c) 2024 Smol - MIT')
  })

  it('omits x-source-uri/x-uri entirely for a data uri (genuinely no source location)', () => {
    const headers = attributionHeaders({ uri: 'data:image/png;base64,abc' })
    expect(headers).not.toHaveProperty('x-source-uri')
    expect(headers).not.toHaveProperty('x-uri')
  })

  it('omits the uri rather than throwing when it cannot be encoded at all', () => {
    // A lone surrogate is not valid text, so encodeURI throws on it. The image
    // still has to be served: a header that cannot be built is dropped, never
    // allowed to become an exception on the response path. Reachable in practice
    // through a truncated or mis-decoded value stored by a collector.
    const headers = attributionHeaders({ uri: 'https://example.test/\uD800.png' })
    expect(headers).not.toHaveProperty('x-source-uri')
    expect(headers).not.toHaveProperty('x-uri')
    // The rest of the attribution still goes out — losing one fact must not lose
    // the licence along with it.
    expect(headers['x-license']).toBe('unknown')
    expect(headers.link).toBe('<https://gib.show/terms>; rel="license"')
  })

  it('omits x-source-uri/x-uri entirely when no uri is given at all', () => {
    const headers = attributionHeaders({ providerKey: 'trustwallet' })
    expect(headers).not.toHaveProperty('x-source-uri')
    expect(headers).not.toHaveProperty('x-uri')
  })

  it('omits x-provider and x-provider-name when the source cannot be resolved', () => {
    const headers = attributionHeaders({ uri: 'https://cdn.unrelated-host.example/logo.png' })
    expect(headers).not.toHaveProperty('x-provider')
    expect(headers).not.toHaveProperty('x-provider-name')
  })

  // The licence registry holds the four sources whose LICENSE files have been
  // read. Production serves images from 59 provider keys. Naming the provider
  // only for registry members would leave the large majority of responses with
  // no provider at all, so the recorded provider key must survive an unverified
  // licence. Knowing where an image came from and knowing its terms are two
  // separate facts, and this asserts they are reported separately.
  it('names a recorded provider whose licence has never been verified', () => {
    const headers = attributionHeaders({
      providerKey: 'coingecko',
      uri: 'https://assets.coingecko.example/images/1/large/logo.png',
    })
    expect(headers['x-provider']).toBe('coingecko')
    expect(headers['x-license']).toBe('unknown')
    expect(headers).not.toHaveProperty('x-provider-name')
    expect(headers).not.toHaveProperty('x-license-url')
  })

  it('reports the collector and the file licence separately when they differ', () => {
    // A row that names its collector is authoritative about who supplied the
    // file; the uri is authoritative about where the file came from. They can
    // legitimately disagree, and both facts matter — the caller needs the licence
    // of the artwork, not of whoever passed it along.
    const headers = attributionHeaders({
      providerKey: 'gibs',
      uri: 'smoldapp-tokenassets/chains/1/logo.svg',
    })
    expect(headers['x-provider']).toBe('gibs')
    expect(headers['x-license']).toBe('MIT')
    expect(headers['x-attribution']).toBe('Copyright (c) 2024 Smol - MIT')
    // The display name is withheld rather than guessed: naming this "Smol" beside
    // x-provider: gibs would assert the two are the same party.
    expect(headers).not.toHaveProperty('x-provider-name')
  })

  it('omits x-attribution when the resolved source has none', () => {
    const headers = attributionHeaders({})
    expect(headers).not.toHaveProperty('x-attribution')
  })

  // Regression: pls369/pulsechain-assets has an identifiable provider and a
  // licenceUrl kept as evidence, but no licence was ever granted. The public
  // header contract says x-license-url is omitted whenever x-license reads
  // 'unknown' — do not leak the README url as if it were a licence url.
  it('omits x-license-url when the licence is unknown even though the registry entry carries a url', () => {
    const headers = attributionHeaders({ providerKey: 'pls369' })
    expect(headers['x-license']).toBe('unknown')
    expect(headers['x-provider']).toBe('pls369')
    expect(headers['x-provider-name']).toBe('PLS369 / pulsechain-assets')
    expect(headers).not.toHaveProperty('x-license-url')
    // The attribution note is still surfaced — it explains the situation.
    expect(headers['x-attribution']).toContain('open for all projects to use')
  })

  it('exposes every documented header name in ATTRIBUTION_HEADER_NAMES', () => {
    expect(ATTRIBUTION_HEADER_NAMES).toEqual([
      'link',
      'x-source-uri',
      'x-provider',
      'x-provider-name',
      'x-license',
      'x-license-url',
      'x-attribution',
      'x-uri',
    ])
  })

  it('never emits an empty-string or placeholder value for an omitted fact', () => {
    const headers = attributionHeaders({})
    for (const value of Object.values(headers)) {
      expect(value).not.toBe('')
      expect(value).not.toBeUndefined()
      expect(value).not.toBeNull()
    }
  })
})
