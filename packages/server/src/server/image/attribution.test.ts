import { describe, it, expect, vi } from 'vitest'

// Deterministic submodules root so relative-path assertions don't depend on
// where this checkout happens to live on disk.
vi.mock('../../paths', () => ({ submodules: '/submodules' }))

import {
  sourceKeyFromUri,
  resolveAttribution,
  attributionHeaders,
  ATTRIBUTION_HEADER_NAMES,
  sourceOwningAddress,
  sourceLicenseForProviderKey,
  effectiveEntryLicense,
} from './attribution'

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

  it('falls back to the bare hostname for a raw.githubusercontent.com address with no repository segment', () => {
    // Neither submoduleNameForPublicAddress nor the live-github check can name an
    // owner with nothing after it — there is no repository to compare.
    expect(sourceKeyFromUri('https://raw.githubusercontent.com/onlyowner')).toBe('raw.githubusercontent.com')
  })

  it('returns the whole value when it has no path separator', () => {
    expect(sourceKeyFromUri('trustwallet')).toBe('trustwallet')
  })

  it('returns null when the first segment is empty (leading slash)', () => {
    expect(sourceKeyFromUri('/chains/1/logo.svg')).toBeNull()
  })
})

describe('resolveAttribution', () => {
  // A provider key never grants its licence alone (see the ethereum-lists tests
  // below for why): every case here pairs the key with an address that
  // verifies as that same provider's own artwork, exactly as every real
  // serving path already does — img.uri and img.providerKey travel together.
  it('resolves a known provider key once the address verifies as its own artwork', () => {
    const source = resolveAttribution({
      providerKey: 'trustwallet',
      uri: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xabc/logo.png',
    })
    expect(source.sourceKey).toBe('trustwallet')
    expect(source.license).toBe('MIT')
  })

  it('withholds a real licence claimed by provider key alone, with no address to confirm it', () => {
    // The defensive half of the test above: no uri at all means nothing can be
    // verified, so a real (non-'unknown') licence claim is never granted on the
    // provider key's say-so.
    const source = resolveAttribution({ providerKey: 'trustwallet' })
    expect(source.sourceKey).toBe('unknown')
    expect(source.license).toBe('unknown')
  })

  it('resolves the smoldapp provider key and its submodule-directory alias to the same entry', () => {
    const byProviderKey = resolveAttribution({
      providerKey: 'smoldapp',
      uri: 'smoldapp-tokenassets/chains/1/logo.svg',
    })
    const byUri = resolveAttribution({ uri: 'smoldapp-tokenassets/chains/1/logo.svg' })
    expect(byProviderKey.sourceKey).toBe('smoldapp')
    expect(byUri.sourceKey).toBe('smoldapp')
    expect(byProviderKey).toEqual(byUri)
  })

  // This is the fix for a real defect: ethereum-lists is registered as MIT for
  // its own repository (token definitions), but that repository holds no
  // images — every ethereum-lists entry's image address is an arbitrary
  // external host (imgur and others) named in the token's own `logo` field.
  // Granting MIT from the provider key alone served every one of those images
  // as MIT regardless of where the file actually lived.
  it('does not grant MIT to an ethereum-lists entry pointing at an outside host', () => {
    const source = resolveAttribution({ providerKey: 'ethereum-lists', uri: 'https://i.imgur.com/abc123.png' })
    expect(source.sourceKey).toBe('unknown')
    expect(source.license).toBe('unknown')
  })

  it('does not grant MIT to the ethereum-lists provider key with no address at all', () => {
    const source = resolveAttribution({ providerKey: 'ethereum-lists' })
    expect(source.sourceKey).toBe('unknown')
    expect(source.license).toBe('unknown')
  })

  it('never treats an ethereum-lists local path as its own artwork — it hosts none', () => {
    // ethereum-lists has no ownArtwork location (see the registry entry's own
    // reasoning), so even a uri that LOOKS like it names ethereum-lists' own
    // submodule tree must not verify — unlike trustwallet/smoldapp/pls369,
    // whose local paths do verify their own images.
    const source = resolveAttribution({ uri: '/submodules/ethereum-lists-tokens/tokens/eth/0xabc.json' })
    expect(source.sourceKey).toBe('unknown')
    expect(source.license).toBe('unknown')
  })

  it('resolves the web3icons provider key, fetched live rather than through a submodule alias', () => {
    const source = resolveAttribution({
      providerKey: 'web3icons',
      uri: 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/networks/branded/zksync.svg',
    })
    expect(source.sourceKey).toBe('web3icons')
    expect(source.license).toBe('MIT')
    expect(source.attribution).toBe('Copyright (c) 2024 0xa3k5 - MIT')
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

  // The licence registry holds the five sources whose licence files have been
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

  it('publishes the full attribution set for web3icons, fetched live rather than through a submodule', () => {
    const headers = attributionHeaders({
      providerKey: 'web3icons',
      uri: 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/networks/branded/zksync.svg',
    })
    expect(headers['x-provider']).toBe('web3icons')
    expect(headers['x-provider-name']).toBe('0xa3k5/web3icons')
    expect(headers['x-license']).toBe('MIT')
    expect(headers['x-license-url']).toBe('https://github.com/0xa3k5/web3icons/blob/main/LICENCE')
    expect(headers['x-attribution']).toBe('Copyright (c) 2024 0xa3k5 - MIT')
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

describe('a public address into a vendored repository', () => {
  const SMOLDAPP = 'https://raw.githubusercontent.com/SmolDapp/tokenAssets/1b2352b8/chains/1/logo.svg'

  it('names its source by repository, not by the host every one of them shares', () => {
    expect(sourceKeyFromUri(SMOLDAPP)).toBe('smoldapp-tokenassets')
  })

  it('keeps its licence when nothing but the address is known', () => {
    // The content-addressed route holds no provider - one stored image can belong to
    // several - so the address is all attribution has. Recording a public address in
    // place of a local path turned this into "unknown" until the address could be
    // read for its repository.
    const source = resolveAttribution({ providerKey: null, uri: SMOLDAPP })
    expect(source.license).toBe('MIT')
  })

  it('still falls back to the host for a repository that is not one of ours', () => {
    expect(sourceKeyFromUri('https://raw.githubusercontent.com/someone/else/abc/logo.png')).toBe(
      'raw.githubusercontent.com',
    )
  })
})

describe('sourceOwningAddress', () => {
  it("verifies a public address into trustwallet as trustwallet's own artwork", () => {
    const owning = sourceOwningAddress(
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xabc/logo.png',
    )
    expect(owning?.sourceKey).toBe('trustwallet')
  })

  it("verifies a public address into web3icons as web3icons's own artwork", () => {
    const owning = sourceOwningAddress('https://raw.githubusercontent.com/0xa3k5/web3icons/main/logo.svg')
    expect(owning?.sourceKey).toBe('web3icons')
  })

  it('verifies a local submodule path the same way as a public address', () => {
    const owning = sourceOwningAddress('smoldapp-tokenassets/chains/1/logo.svg')
    expect(owning?.sourceKey).toBe('smoldapp')
  })

  it('refuses an ethereum-lists address — that repository hosts no images', () => {
    expect(sourceOwningAddress('/submodules/ethereum-lists-tokens/tokens/eth/0xabc.json')).toBeNull()
  })

  it('refuses an address on a host none of the registry entries own', () => {
    expect(sourceOwningAddress('https://i.imgur.com/abc123.png')).toBeNull()
  })

  it('refuses a null or absent address', () => {
    expect(sourceOwningAddress(null)).toBeNull()
    expect(sourceOwningAddress(undefined)).toBeNull()
  })
})

describe('sourceLicenseForProviderKey', () => {
  it('returns the registry entry for a known provider key', () => {
    expect(sourceLicenseForProviderKey('trustwallet')?.license).toBe('MIT')
  })

  it('returns null for an unregistered provider key', () => {
    expect(sourceLicenseForProviderKey('coingecko')).toBeNull()
  })

  it('returns null for an absent provider key', () => {
    expect(sourceLicenseForProviderKey(null)).toBeNull()
    expect(sourceLicenseForProviderKey(undefined)).toBeNull()
  })
})

describe('effectiveEntryLicense', () => {
  // Rule 1: the list's own licence, but ONLY for its own provider's own artwork.
  //
  // Deliberately uses an OVERRIDE licence that disagrees with trustwallet's own
  // registry default (MIT). If this test used listLicense: 'MIT', a version of
  // effectiveEntryLicense that always fell through to rule 2 (the address's own
  // verified source) would ALSO answer 'MIT' — for the wrong reason — and the
  // test would pass while proving nothing about rule 1 specifically. Asserting
  // the override value is what forces rule 1's own branch to run.
  it("grants the list's licence to an address that verifies as its own provider's artwork", () => {
    const license = effectiveEntryLicense({
      listProviderKey: 'trustwallet',
      listLicense: 'Custom-Override-1.0',
      imageAddress:
        'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xabc/logo.png',
    })
    expect(license).toBe('Custom-Override-1.0')
  })

  // This is the distinguishing case for "a list's licence applies to its own
  // artwork and not to an image it merely points at elsewhere": the list's
  // OWN registered licence (Apache-2.0) deliberately disagrees with the
  // address's real, independently-verified owner (trustwallet, MIT). A version
  // of effectiveEntryLicense that granted the list's licence for ANY verified
  // address — not just its own provider's — would answer Apache-2.0 here,
  // which is the over-claim this rule exists to prevent. The correct answer is
  // MIT, from rule 2, entirely independent of what the list itself claims.
  it("does not grant the list's licence to an address it merely points at elsewhere", () => {
    const license = effectiveEntryLicense({
      listProviderKey: 'some-uniswap-fed-list-provider',
      listLicense: 'Apache-2.0',
      imageAddress:
        'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xabc/logo.png',
    })
    expect(license).toBe('MIT')
    expect(license).not.toBe('Apache-2.0')
    // Proof this came from rule 2, not rule 1: the SAME address with the list's
    // OWN provider unregistered and no listLicense at all still resolves the
    // same way, via sourceOwningAddress alone.
    expect(
      effectiveEntryLicense({
        listProviderKey: 'some-uniswap-fed-list-provider',
        listLicense: null,
        imageAddress:
          'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xabc/logo.png',
      }),
    ).toBe('MIT')
  })

  it("withholds the list's own licence when the address does not verify as ANY known source's artwork", () => {
    const license = effectiveEntryLicense({
      listProviderKey: 'trustwallet',
      listLicense: 'MIT',
      imageAddress: 'https://cdn.unrelated-host.example/logo.png',
    })
    expect(license).toBeNull()
  })

  // The required "LiFi-style entry" proof: a list belonging to an entirely
  // unregistered provider, pointing into a verified repository, earns that
  // repository's own licence.
  it('grants a verified repository licence to a LiFi-style entry pointing into it', () => {
    const license = effectiveEntryLicense({
      listProviderKey: 'lifi',
      listLicense: null,
      imageAddress:
        'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xabc/logo.png',
    })
    expect(license).toBe('MIT')
  })

  // The required "ethereum-lists over-claim" proof, at the exact point the
  // fix has to hold: the moment the licence is computed and stored.
  it('never grants ethereum-lists MIT for an entry pointing at an outside host', () => {
    const license = effectiveEntryLicense({
      listProviderKey: 'ethereum-lists',
      listLicense: 'MIT',
      imageAddress: 'https://i.imgur.com/abc123.png',
    })
    expect(license).toBeNull()
  })

  it("never grants MIT via a list's own claim for an address inside ethereum-lists' own tree — it owns no artwork", () => {
    const license = effectiveEntryLicense({
      listProviderKey: 'ethereum-lists',
      listLicense: 'MIT',
      imageAddress: '/submodules/ethereum-lists-tokens/tokens/eth/0xabc.json',
    })
    expect(license).toBeNull()
  })

  it('never grants a licence for a source whose own terms are unverified, even when the address is genuinely its own', () => {
    // pls369's own repository does hold this address's artwork, but its
    // licence is 'unknown' — there is nothing to grant, from either rule.
    const license = effectiveEntryLicense({
      listProviderKey: 'pls369',
      listLicense: null,
      imageAddress: '/submodules/pulsechain-assets/blockchain/pulsechain/assets/0xabc/logo.png',
    })
    expect(license).toBeNull()
  })

  it('returns null for an address with no source location information at all', () => {
    expect(effectiveEntryLicense({ listProviderKey: null, listLicense: null, imageAddress: null })).toBeNull()
    expect(effectiveEntryLicense({ listProviderKey: 'trustwallet', listLicense: 'MIT', imageAddress: null })).toBeNull()
  })
})

describe('attributionHeaders with a precomputed entry licence', () => {
  it("reports the entry's stored licence, with url/attribution recovered from the current address, when it still verifies", () => {
    const headers = attributionHeaders({
      providerKey: 'trustwallet',
      uri: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xabc/logo.png',
      entryLicense: 'MIT',
    })
    expect(headers['x-license']).toBe('MIT')
    expect(headers['x-license-url']).toBe('https://github.com/trustwallet/assets/blob/master/LICENSE')
    expect(headers['x-attribution']).toBe('Copyright (c) 2019-2023 Trust Wallet - MIT')
  })

  it("falls back to the list's own registered url/attribution when the address no longer verifies but matches the list's own licence", () => {
    const headers = attributionHeaders({
      providerKey: 'some-provider',
      uri: 'https://cdn.unrelated-host.example/logo.png',
      entryLicense: 'Apache-2.0',
      listLicense: 'Apache-2.0',
      listLicenseUrl: 'https://example.test/apache',
      listAttribution: 'Example Corp',
    })
    expect(headers['x-license']).toBe('Apache-2.0')
    expect(headers['x-license-url']).toBe('https://example.test/apache')
    expect(headers['x-attribution']).toBe('Example Corp')
  })

  it('still reports a stored licence with no url or attribution when neither the address nor the list account for it', () => {
    const headers = attributionHeaders({
      providerKey: 'some-provider',
      uri: 'https://cdn.unrelated-host.example/logo.png',
      entryLicense: 'MIT',
      listLicense: null,
    })
    expect(headers['x-license']).toBe('MIT')
    expect(headers).not.toHaveProperty('x-license-url')
    expect(headers).not.toHaveProperty('x-attribution')
  })

  it("names the list-matched source by a registered provider's own display name, when it has one", () => {
    const headers = attributionHeaders({
      providerKey: 'trustwallet',
      // Unrelated to trustwallet's own artwork, so the address-based match at
      // rule 2 cannot fire and the list-licence match below has to.
      uri: 'https://cdn.unrelated-host.example/logo.png',
      entryLicense: 'MIT',
      listLicense: 'MIT',
      listLicenseUrl: 'https://example.test/custom',
      listAttribution: 'Custom notice',
    })
    expect(headers['x-license']).toBe('MIT')
    expect(headers['x-license-url']).toBe('https://example.test/custom')
    expect(headers['x-attribution']).toBe('Custom notice')
  })

  it('falls back to null url/attribution for a list-licence match that provides neither', () => {
    const headers = attributionHeaders({
      providerKey: 'some-provider',
      uri: 'https://cdn.unrelated-host.example/logo.png',
      entryLicense: 'MIT',
      listLicense: 'MIT',
    })
    expect(headers['x-license']).toBe('MIT')
    expect(headers).not.toHaveProperty('x-license-url')
    expect(headers).not.toHaveProperty('x-attribution')
  })

  it('resolves a list-licence match and a fully-unmatched licence with no provider key at all', () => {
    const matched = attributionHeaders({
      uri: 'https://cdn.unrelated-host.example/logo.png',
      entryLicense: 'MIT',
      listLicense: 'MIT',
      listLicenseUrl: 'https://example.test/custom',
      listAttribution: 'Custom notice',
    })
    expect(matched['x-license']).toBe('MIT')
    expect(matched['x-license-url']).toBe('https://example.test/custom')

    const unmatched = attributionHeaders({
      uri: 'https://cdn.unrelated-host.example/logo.png',
      entryLicense: 'MIT',
      listLicense: null,
    })
    expect(unmatched['x-license']).toBe('MIT')
    expect(unmatched).not.toHaveProperty('x-license-url')
  })
})
