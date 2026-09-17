/**
 * @module image/attribution
 * Copyright attribution for redistributed token and chain artwork.
 *
 * gib.show redistributes artwork collected from third-party sources. Three of the
 * submodules under `submodules/` and one source fetched live (web3icons) carry the
 * Massachusetts-Institute-of-Technology (MIT) licence, which requires the copyright
 * and permission notice to travel with every copy. This module is the single place
 * that decides which source produced a served image and what attribution that
 * source requires, so `sendImage` and `sendVariant` cannot drift apart on the
 * answer.
 *
 * Every entry below was populated by opening the named source's own licence file
 * and copying its real copyright line. A source with no verified licence is marked
 * `'unknown'` — never guessed — because a guessed licence is worse than an absent one.
 */
import * as path from 'path'
import { submodules } from '../../paths'

/**
 * What is known about the licence terms of one redistributed source.
 */
export type SourceLicense = {
  /** Canonical identifier for this source (its provider key, or submodule directory name). */
  readonly sourceKey: string
  /** Human-readable name of the source, for display. */
  readonly name: string
  /** A Software-Package-Data-Exchange (SPDX) licence identifier, or the literal `'unknown'`. */
  readonly license: string
  /** Where to read the full licence text, or `null` when there is none to point to. */
  readonly licenseUrl: string | null
  /** The copyright line to reproduce, or `null` when there is none to reproduce. */
  readonly attribution: string | null
}

/** The entry returned when a source cannot be identified or has no verified licence. */
const UNKNOWN_SOURCE: SourceLicense = Object.freeze({
  sourceKey: 'unknown',
  name: 'unknown source',
  license: 'unknown',
  licenseUrl: null,
  attribution: null,
})

/**
 * Trust Wallet — submodule `submodules/trustwallet`, provider key `trustwallet`.
 * Verified against `submodules/trustwallet/LICENSE`: MIT, copyright line
 * "Copyright (c) 2019-2023 Trust Wallet".
 */
const TRUSTWALLET: SourceLicense = Object.freeze({
  sourceKey: 'trustwallet',
  name: 'Trust Wallet',
  license: 'MIT',
  licenseUrl: 'https://github.com/trustwallet/assets/blob/master/LICENSE',
  attribution: 'Copyright (c) 2019-2023 Trust Wallet - MIT',
})

/**
 * Smoldapp Token Assets — submodule `submodules/smoldapp-tokenassets`, provider key
 * `smoldapp`. Verified against `submodules/smoldapp-tokenassets/LICENSE`: MIT,
 * copyright line "Copyright (c) 2024 Smol".
 */
const SMOLDAPP: SourceLicense = Object.freeze({
  sourceKey: 'smoldapp',
  name: 'Smol',
  license: 'MIT',
  licenseUrl: 'https://github.com/SmolDapp/tokenAssets/blob/main/LICENSE',
  attribution: 'Copyright (c) 2024 Smol - MIT',
})

/**
 * Ethereum Lists — submodule `submodules/ethereum-lists-tokens`, provider key
 * `ethereum-lists`. Verified against `submodules/ethereum-lists-tokens/LICENSE`:
 * MIT, copyright line "Copyright (c) 2018 ethereum-lists".
 */
const ETHEREUM_LISTS: SourceLicense = Object.freeze({
  sourceKey: 'ethereum-lists',
  name: 'ethereum-lists',
  license: 'MIT',
  licenseUrl: 'https://github.com/ethereum-lists/tokens/blob/master/LICENSE',
  attribution: 'Copyright (c) 2018 ethereum-lists - MIT',
})

/**
 * web3icons — provider key `web3icons`, fetched directly from the 0xa3k5/web3icons
 * GitHub repository rather than a vendored submodule (it supplies only network
 * artwork, and the collector reads its metadata and icon files straight from
 * `raw.githubusercontent.com` on every run). Verified against the repository's own
 * `LICENCE` file (note the British spelling — there is no `LICENSE` at the root) at
 * `https://raw.githubusercontent.com/0xa3k5/web3icons/main/LICENCE`, and confirmed
 * independently by the GitHub API's `license.spdx_id`: MIT, copyright line
 * "Copyright (c) 2024 0xa3k5".
 */
const WEB3ICONS: SourceLicense = Object.freeze({
  sourceKey: 'web3icons',
  name: '0xa3k5/web3icons',
  license: 'MIT',
  licenseUrl: 'https://github.com/0xa3k5/web3icons/blob/main/LICENCE',
  attribution: 'Copyright (c) 2024 0xa3k5 - MIT',
})

/**
 * PLS369 pulsechain-assets — submodule `submodules/pulsechain-assets`, provider key
 * `pls369`. Checked and confirmed: this submodule carries no `LICENSE` file at all.
 *
 * Its `README.md` says the repository is "open for all projects to use" and
 * recommends hotlinking and redistribution through a content delivery network.
 * That is an informal invitation to reuse the data, not a licence grant — it names
 * no permitted uses, carries no warranty disclaimer, and grants no rights a licence
 * would. Recording `license: 'MIT'` or any other Software-Package-Data-Exchange
 * identifier here would assert something nobody has granted, so this stays
 * `'unknown'` on purpose. `licenseUrl` still points at the README so a reader who
 * sees `x-license: unknown` can go read the same informal invitation for
 * themselves — do not read that URL as evidence of a formal licence and silently
 * upgrade this entry to MIT or public domain.
 */
const PULSECHAIN_ASSETS: SourceLicense = Object.freeze({
  sourceKey: 'pls369',
  name: 'PLS369 / pulsechain-assets',
  license: 'unknown',
  licenseUrl: 'https://github.com/PLS369/pulsechain-assets/blob/main/README.md',
  attribution:
    'PLS369 / pulsechain-assets - the source states its data is "open for all projects to use" but grants no formal licence.',
})

/**
 * Registry of every source gib.show can attribute, keyed by both the provider key
 * recorded on the database row and the submodule directory name embedded in a
 * relative source uri — so every code path that resolves attribution (database
 * lookup by provider key, or uri inspection when no provider is joined) reaches the
 * same entry.
 */
const SOURCE_REGISTRY: Readonly<Record<string, SourceLicense>> = Object.freeze({
  trustwallet: TRUSTWALLET,
  smoldapp: SMOLDAPP,
  'smoldapp-tokenassets': SMOLDAPP,
  'ethereum-lists': ETHEREUM_LISTS,
  'ethereum-lists-tokens': ETHEREUM_LISTS,
  web3icons: WEB3ICONS,
  pls369: PULSECHAIN_ASSETS,
  'pulsechain-assets': PULSECHAIN_ASSETS,
})

/**
 * Derive the registry lookup key a source uri names, or `null` when the uri
 * carries no source identity of its own.
 *
 * A relative submodule path names its source by its first path segment
 * (`smoldapp-tokenassets/chains/1/logo.svg` → `smoldapp-tokenassets`). An
 * `http(s)` uri names its source by hostname. An `ipfs:` or `data:` uri names no
 * particular host or directory, so both yield `null`.
 */
export function sourceKeyFromUri(uri: string): string | null {
  if (!uri) return null
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    // http(s) is a "special" scheme in the WHATWG URL standard, so a
    // successfully parsed instance always has a non-empty host — the only
    // failure mode worth handling is the parse itself throwing.
    try {
      return new URL(uri).hostname
    } catch {
      return null
    }
  }
  if (uri.startsWith('ipfs:') || uri.startsWith('data:')) {
    return null
  }
  const [firstSegment] = uri.split('/')
  return firstSegment || null
}

/**
 * Reduce a raw stored image uri to the form attribution can reason about: an
 * `http(s)` or `ipfs` uri passes through unchanged, a `data:` uri carries no
 * source identity and is dropped, and a local filesystem path — collectors store
 * these as absolute paths under the submodules directory — is rewritten relative
 * to that directory (`smoldapp-tokenassets/chains/1/logo.svg`) so its first
 * segment names the source and matches the registry key. A uri that is already
 * relative passes through unchanged — `path.relative()` resolves a relative
 * input against the current working directory rather than against
 * `submodules`, which would silently mangle it into an unrelated path.
 */
function normalizeSourceUri(uri: string | null | undefined): string | undefined {
  if (!uri) return undefined
  if (uri.startsWith('http') || uri.startsWith('ipfs')) return uri
  if (uri.startsWith('data:')) return undefined
  if (!path.isAbsolute(uri)) return uri
  const relative = path.relative(submodules, uri)
  // A path stored outside the submodules directory relativises to something that
  // climbs out of it (`../../var/lib/...`). Publishing that would describe the
  // server's own filesystem layout to every caller, and it names no source we can
  // attribute anyway, so it is dropped rather than exposed.
  if (relative.startsWith('..')) return undefined
  return relative
}

/**
 * Resolve the licence and attribution for one served image. Tries the provider
 * key recorded on the database row first, then the source key the uri itself
 * names, and falls back to the unknown entry when neither resolves.
 */
export function resolveAttribution({
  providerKey,
  uri,
}: {
  providerKey?: string | null
  uri?: string | null
}): SourceLicense {
  if (providerKey && SOURCE_REGISTRY[providerKey]) {
    return SOURCE_REGISTRY[providerKey]
  }
  const normalizedUri = normalizeSourceUri(uri)
  const uriSourceKey = normalizedUri ? sourceKeyFromUri(normalizedUri) : null
  if (uriSourceKey && SOURCE_REGISTRY[uriSourceKey]) {
    return SOURCE_REGISTRY[uriSourceKey]
  }
  return UNKNOWN_SOURCE
}

/**
 * Decide which entity to name as the provider of a served image, and the display
 * name to publish beside it.
 *
 * The provider key recorded on the database row wins whenever it is present. It
 * names the collector that supplied the file and exists for every collector,
 * while the licence registry above holds only the few sources whose terms have
 * actually been read. Keying the provider header off the licence registry would
 * leave the large majority of responses naming no provider at all, which is the
 * opposite of attribution. When the row carries no provider, the source the uri
 * identifies is the best answer available.
 *
 * The display name is returned only when it describes the SAME entity as the key,
 * so `x-provider` and `x-provider-name` can never name two different parties. The
 * licence is resolved separately and deliberately: it describes the file's origin,
 * which is not always the collector that handed the file over.
 */
function resolveProviderIdentity({
  providerKey,
  source,
}: {
  providerKey?: string | null
  source: SourceLicense
}): { key: string; name: string | null } | null {
  if (providerKey) {
    return { key: providerKey, name: SOURCE_REGISTRY[providerKey]?.name ?? null }
  }
  if (source.sourceKey === UNKNOWN_SOURCE.sourceKey) {
    return null
  }
  return { key: source.sourceKey, name: source.name }
}

/**
 * Characters Node will accept in a response header value: horizontal tab, the
 * printable range, and the high half of Latin-1. Node's own validator rejects
 * everything else, including every code point above U+00FF and both carriage
 * return and line feed.
 */
const HEADER_UNSAFE_CHARACTER = /[^\t\x20-\x7e\x80-\xff]/

/**
 * Return a value only if it can legally be a header, otherwise nothing.
 *
 * This exists because everything this module publishes is DATA, not literals we
 * control: a source uri comes out of the database, and an attribution line is a
 * copyright notice typed by a person. An em dash in one of those constants took
 * every image response with a recognised provider to a 500, because Node throws
 * `ERR_INVALID_CHAR` rather than dropping the header. A stored uri carrying a
 * non-Latin-1 character, or a carriage return, would do exactly the same, and a
 * carriage return would be a response-splitting vector if Node ever stopped
 * refusing it.
 *
 * Dropping the single offending header is the right failure: the image still
 * serves, and one missing attribution header is a far smaller harm than a 500 on
 * every request for that provider. Callers that publish something they consider
 * mandatory should assert its presence rather than assume it.
 */
function headerSafe(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (HEADER_UNSAFE_CHARACTER.test(value)) return undefined
  return value
}

/**
 * The same guard for a uri, with one extra attempt before giving up: a uri whose
 * only problem is a non-Latin-1 character — an internationalised domain, a
 * non-Latin filename — has a lossless and standard header-safe form, its
 * percent-encoding. Encoding is tried only when the raw value is already unsafe,
 * so a uri that is fine is published exactly as stored and never double-encoded.
 */
function headerSafeUri(uri: string | undefined): string | undefined {
  const asStored = headerSafe(uri)
  if (asStored) return asStored
  if (!uri) return undefined
  try {
    return headerSafe(encodeURI(uri))
  } catch {
    // encodeURI throws on a lone surrogate; there is no correct encoding to fall
    // back to, so the header is omitted.
    return undefined
  }
}

/** Every header name this module can emit — the exact set `cors()` must expose. */
export const ATTRIBUTION_HEADER_NAMES = [
  'link',
  'x-source-uri',
  'x-provider',
  'x-provider-name',
  'x-license',
  'x-license-url',
  'x-attribution',
  'x-uri',
] as const

/** The public licence-terms page every response links back to. */
const LICENSE_LINK_HEADER = '<https://gib.show/terms>; rel="license"'

/**
 * Build the full set of attribution headers for one served image. Pure — it
 * returns a plain record for the caller to apply to a response, rather than
 * touching a Response object itself, so `sendImage` and `sendVariant` can share
 * one code path without either owning the other's response object.
 *
 * A header is omitted entirely, never emitted empty or with a placeholder value,
 * when the underlying fact is unavailable — no source uri, an unresolved
 * provider, or an unverified licence.
 */
export function attributionHeaders({
  uri,
  providerKey,
}: {
  uri?: string | null
  providerKey?: string | null
}): Record<string, string> {
  const source = resolveAttribution({ providerKey, uri })
  const headers: Record<string, string> = {
    link: LICENSE_LINK_HEADER,
    'x-license': source.license,
  }
  const set = (name: string, value: string | null | undefined): void => {
    const safe = headerSafe(value)
    if (safe) headers[name] = safe
  }
  const normalizedUri = headerSafeUri(normalizeSourceUri(uri))
  if (normalizedUri) {
    headers['x-source-uri'] = normalizedUri
    // Backwards-compatible alias — existing consumers already read x-uri.
    headers['x-uri'] = normalizedUri
  }
  const provider = resolveProviderIdentity({ providerKey, source })
  set('x-provider', provider?.key)
  set('x-provider-name', provider?.name)
  if (source.license !== 'unknown') {
    set('x-license-url', source.licenseUrl)
  }
  set('x-attribution', source.attribution)
  return headers
}
