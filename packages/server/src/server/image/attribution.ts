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
 *
 * A PROVIDER is not the right unit for a licence: one provider can publish many
 * lists under different terms (the Uniswap collector alone reads twenty-two lists
 * from twenty-two different publishers), and a list can only license artwork it
 * actually owns — a list that merely points at someone else's image cannot grant
 * a licence to it. So the licence lives on the LIST (`list.license` and friends,
 * set by `insertList`), and the EFFECTIVE licence of one entry's image is decided
 * once, at collection time, by `effectiveEntryLicense` below, using both the
 * list's own licence and the `ownArtwork` location recorded on each registry entry
 * here. Never a provider key alone: `sourceOwningAddress` and `resolveAttribution`
 * both require the served address to verify against a registry entry's own
 * artwork location before trusting that entry's licence for it.
 */
import * as path from 'path'
import { submodules } from '../../paths'
import { submoduleNameForPublicAddress, SUBMODULE_REPOSITORIES, PUBLIC_CONTENT_HOST } from '../../submodule-source'

/** A GitHub repository where a source keeps its OWN artwork — never a repository it merely links to. */
export type OwnArtworkRepository = {
  readonly owner: string
  readonly repo: string
}

/**
 * What is known about the licence terms of one redistributed source.
 */
export type SourceLicense = {
  /** Canonical identifier for this source (its provider key, or submodule directory name). */
  readonly sourceKey: string
  /** Human-readable name of the source, for display, or null when none applies. */
  readonly name: string | null
  /** A Software-Package-Data-Exchange (SPDX) licence identifier, or the literal `'unknown'`. */
  readonly license: string
  /** Where to read the full licence text, or `null` when there is none to point to. */
  readonly licenseUrl: string | null
  /** The copyright line to reproduce, or `null` when there is none to reproduce. */
  readonly attribution: string | null
  /**
   * Where this source keeps its OWN artwork, or `null` when it hosts none (ethereum-lists:
   * its repository holds token definitions, never images). An address only earns this
   * source's licence when it verifiably falls inside this location — see
   * `sourceOwningAddress` — never from a provider key or a list's own claim alone.
   */
  readonly ownArtwork: OwnArtworkRepository | null
}

/** The entry returned when a source cannot be identified or has no verified licence. */
const UNKNOWN_SOURCE: SourceLicense = Object.freeze({
  sourceKey: 'unknown',
  name: 'unknown source',
  license: 'unknown',
  licenseUrl: null,
  attribution: null,
  ownArtwork: null,
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
  // Reused from submodule-source.ts's own owner/repository mapping rather than
  // retyped, so the two never drift apart on where this repository lives.
  ownArtwork: { owner: SUBMODULE_REPOSITORIES.trustwallet.owner, repo: SUBMODULE_REPOSITORIES.trustwallet.repo },
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
  ownArtwork: {
    owner: SUBMODULE_REPOSITORIES['smoldapp-tokenassets'].owner,
    repo: SUBMODULE_REPOSITORIES['smoldapp-tokenassets'].repo,
  },
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
  // No artwork ownership on purpose: this repository holds token DEFINITIONS
  // (each entry's `logo` field is a URL into whatever host the submitter chose —
  // imgur and others), never the images themselves. Its MIT licence covers its
  // own data, not a file it merely points at, so it never earns an entry's
  // effective licence — see effectiveEntryLicense and sourceOwningAddress.
  ownArtwork: null,
})

/**
 * web3icons's own GitHub repository. Not in submodule-source.ts's
 * SUBMODULE_REPOSITORIES — that map resolves a checked-out commit for a vendored
 * submodule, and web3icons has no local checkout; it is fetched live on every
 * collection run. Recorded once, here, both as this entry's `ownArtwork` and as
 * the pattern `sourceKeyFromUri` matches a public address against, so a list
 * belonging to some OTHER provider that happens to point into this repository
 * (see `effectiveEntryLicense`'s rule 2) still resolves to web3icons's own terms.
 */
const WEB3ICONS_REPOSITORY: OwnArtworkRepository = Object.freeze({ owner: '0xa3k5', repo: 'web3icons' })

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
  // Not in submodule-source.ts's SUBMODULE_REPOSITORIES: that map resolves a
  // checked-out commit, and web3icons has no local checkout to resolve — it is
  // fetched live on every run. Recorded once, here, since this registry is the
  // single source of truth for where a source's own artwork lives.
  ownArtwork: WEB3ICONS_REPOSITORY,
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
  // This repository DOES hold its own artwork — the README's informal invitation
  // is what makes the LICENCE 'unknown', not a claim that the files live
  // elsewhere. Recorded honestly so a future real licence grant (or a list that
  // explicitly overrides this provider's default) has something to verify
  // against; effectiveEntryLicense never grants a licence for an 'unknown' match
  // regardless, so this stays inert for licensing today.
  ownArtwork: {
    owner: SUBMODULE_REPOSITORIES['pulsechain-assets'].owner,
    repo: SUBMODULE_REPOSITORIES['pulsechain-assets'].repo,
  },
})

/**
 * Registry of every source gib.show can attribute, keyed by both the provider key
 * recorded on the database row and the submodule directory name embedded in a
 * relative source uri — so every code path that resolves attribution (database
 * lookup by provider key, or uri inspection when no provider is joined) reaches the
 * same entry.
 */
/**
 * Public GitHub repositories whose artwork other lists point at, each with a
 * licence file of its own. Found by auditing every list the collectors read: for
 * each logo address, which repository it lives in, and what that repository's
 * licence file says. A repository's licence covers only the files in it, so this
 * licenses an image only when its address points INTO the repository - that is
 * what `ownArtwork` and `sourceOwningAddress` enforce.
 *
 * Every row was read from the repository's own licence file through the forge's
 * API, not inferred from a name. Where the licence text carries no project
 * copyright line - GPL's names only the Free Software Foundation, which wrote the
 * licence and not the artwork - the attribution names the repository instead.
 * Three forks of trustwallet/assets carry Trust Wallet's copyright because that is
 * what their own licence files say.
 *
 * Deliberately absent: ethereum-lists/chains is MIT, but its network icons live on
 * IPFS rather than in the repository, so its licence covers the metadata and not
 * the images. Three renamed repositories referenced by at most one image each, at
 * least one of which no longer resolves, were also left out.
 *
 * Adding a source is one row here. It then counts for every list whose entries
 * point into it, on the next collection run.
 */
const LICENSED_GITHUB_REPOSITORIES: readonly (OwnArtworkRepository & {
  license: string
  licenseUrl: string
  attribution: string
})[] = Object.freeze([
  {
    owner: '0xlaozi',
    repo: 'qidao',
    license: 'MIT',
    licenseUrl: 'https://github.com/0xlaozi/qidao/blob/main/LICENSE',
    attribution: 'Copyright (c) 2020 Mai.Finance - MIT',
  },
  {
    owner: '1Hive',
    repo: 'default-token-list',
    license: 'GPL-3.0',
    licenseUrl: 'https://github.com/1Hive/default-token-list/blob/master/LICENSE',
    attribution: '1Hive/default-token-list - GPL-3.0',
  },
  {
    owner: 'aave-dao',
    repo: 'web3-icons',
    license: 'MIT',
    licenseUrl: 'https://github.com/aave-dao/web3-icons/blob/main/LICENSE',
    attribution: 'Copyright (c) 2024 BGD labs - MIT',
  },
  {
    owner: 'Badger-Finance',
    repo: 'badger-system',
    license: 'MIT',
    licenseUrl: 'https://github.com/Badger-Finance/badger-system/blob/master/LICENSE',
    attribution: 'Copyright (c) 2019 brownie-mix - MIT',
  },
  {
    owner: 'balancer',
    repo: 'tokenlists',
    license: 'MIT',
    licenseUrl: 'https://github.com/balancer/tokenlists/blob/main/LICENSE.md',
    attribution: 'Copyright (c) Balancer - MIT',
  },
  {
    owner: 'beefyfinance',
    repo: 'beefy-app',
    license: 'MIT',
    licenseUrl: 'https://github.com/beefyfinance/beefy-app/blob/master/LICENSE',
    attribution: 'Copyright (c) Beefy Finance - MIT',
  }, // archived upstream
  {
    owner: 'cosmos',
    repo: 'chain-registry',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://github.com/cosmos/chain-registry/blob/master/LICENSE',
    attribution: 'cosmos/chain-registry - CC-BY-4.0',
  },
  {
    owner: 'dfx-finance',
    repo: 'assets',
    license: 'MIT',
    licenseUrl: 'https://github.com/dfx-finance/assets/blob/master/LICENSE',
    attribution: 'Copyright (c) 2019-2020 Trust Wallet - MIT',
  },
  {
    owner: 'ErikThiart',
    repo: 'cryptocurrency-icons',
    license: 'MIT',
    licenseUrl: 'https://github.com/ErikThiart/cryptocurrency-icons/blob/master/LICENSE',
    attribution: 'Copyright (c) 2018 Erik Thiart - MIT',
  },
  {
    owner: 'firebird-finance',
    repo: 'firebird-assets',
    license: 'MIT',
    licenseUrl: 'https://github.com/firebird-finance/firebird-assets/blob/master/LICENSE',
    attribution: 'Copyright (c) 2019-2020 Trust Wallet - MIT',
  },
  {
    owner: 'iotexproject',
    repo: 'iotex-token-metadata',
    license: 'Apache-2.0',
    licenseUrl: 'https://github.com/iotexproject/iotex-token-metadata/blob/master/LICENSE',
    attribution: 'iotexproject/iotex-token-metadata - Apache-2.0',
  },
  {
    owner: 'OriginProtocol',
    repo: 'origin-website',
    license: 'MIT',
    licenseUrl: 'https://github.com/OriginProtocol/origin-website/blob/master/LICENSE',
    attribution: 'Copyright (c) 2018 Origin Protocol - MIT',
  },
  {
    owner: 'pangolindex',
    repo: 'tokens',
    license: 'MIT',
    licenseUrl: 'https://github.com/pangolindex/tokens/blob/main/LICENSE',
    attribution: 'Copyright (c) 2020-2021 Pangolin - MIT',
  },
  {
    owner: 'parallel-protocol',
    repo: 'parallel-brand-kit',
    license: 'MIT',
    licenseUrl: 'https://github.com/parallel-protocol/parallel-brand-kit/blob/main/LICENSE',
    attribution: 'Copyright (c) 2025 Parallel Protocol - MIT',
  },
  {
    owner: 'sameepsi',
    repo: 'quickswap-default-token-list',
    license: 'GPL-3.0',
    licenseUrl: 'https://github.com/sameepsi/quickswap-default-token-list/blob/master/LICENSE',
    attribution: 'sameepsi/quickswap-default-token-list - GPL-3.0',
  },
  {
    owner: 'scroll-tech',
    repo: 'token-list',
    license: 'MIT',
    licenseUrl: 'https://github.com/scroll-tech/token-list/blob/main/LICENSE',
    attribution: 'Copyright (c) 2022 Scroll - MIT',
  },
  {
    owner: 'Synthetixio',
    repo: 'synthetix-assets',
    license: 'MIT',
    licenseUrl: 'https://github.com/Synthetixio/synthetix-assets/blob/master/LICENSE',
    attribution: 'Copyright (c) 2020 Synthetix - MIT',
  },
  {
    owner: 'Ubeswap',
    repo: 'default-token-list',
    license: 'MIT',
    licenseUrl: 'https://github.com/Ubeswap/default-token-list/blob/master/LICENSE.txt',
    attribution: 'Copyright (c) 2021 Ube Labs Inc. - MIT',
  },
  {
    owner: 'Uniswap',
    repo: 'assets',
    license: 'MIT',
    licenseUrl: 'https://github.com/Uniswap/assets/blob/master/LICENSE',
    attribution: 'Copyright (c) 2019-2023 Trust Wallet - MIT',
  },
])

/** The registry key for a licensed repository: its owner and name, which no provider key can collide with. */
const repositoryKey = ({ owner, repo }: OwnArtworkRepository) => `${owner}/${repo}`.toLowerCase()

const LICENSED_GITHUB_SOURCES: Readonly<Record<string, SourceLicense>> = Object.freeze(
  Object.fromEntries(
    LICENSED_GITHUB_REPOSITORIES.map((entry) => [
      repositoryKey(entry),
      Object.freeze({
        sourceKey: repositoryKey(entry),
        name: `${entry.owner}/${entry.repo}`,
        license: entry.license,
        licenseUrl: entry.licenseUrl,
        attribution: entry.attribution,
        ownArtwork: Object.freeze({ owner: entry.owner, repo: entry.repo }),
      }),
    ]),
  ),
)

const SOURCE_REGISTRY: Readonly<Record<string, SourceLicense>> = Object.freeze({
  ...LICENSED_GITHUB_SOURCES,
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
 * Non-submodule sources whose own artwork is still verifiable by a fixed GitHub
 * owner/repository, keyed the same way `submoduleNameForPublicAddress` keys the
 * vendored submodules — so `sourceKeyFromUri` can check both with one pattern.
 * Currently only web3icons; add an entry here for any future source that is
 * fetched live rather than vendored.
 */
const LIVE_GITHUB_SOURCES: Readonly<Record<string, OwnArtworkRepository>> = Object.freeze({
  web3icons: WEB3ICONS_REPOSITORY,
  ...Object.fromEntries(
    Object.entries(LICENSED_GITHUB_SOURCES).map(([key, entry]) => [key, entry.ownArtwork as OwnArtworkRepository]),
  ),
})

/**
 * Which known live-fetched (non-submodule) source a public GitHub address names,
 * or `null`. The inverse of `submoduleNameForPublicAddress`, scoped to
 * `LIVE_GITHUB_SOURCES` instead of the vendored submodules.
 */
function liveGithubSourceKeyForPublicAddress(uri: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return null
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  // A project's GitHub Pages site (owner.github.io/repo/...) serves that same
  // repository's files, so it names the repository as surely as the raw host does.
  // Scroll's list points at its artwork this way.
  const pagesOwner = parsed.hostname.endsWith('.github.io') ? parsed.hostname.slice(0, -'.github.io'.length) : null
  const [owner, repo] = pagesOwner ? [pagesOwner, segments[0]] : parsed.hostname === PUBLIC_CONTENT_HOST ? segments : []
  if (!owner || !repo) return null
  const match = Object.entries(LIVE_GITHUB_SOURCES).find(
    ([, repository]) =>
      repository.owner.toLowerCase() === owner.toLowerCase() && repository.repo.toLowerCase() === repo.toLowerCase(),
  )
  return match ? match[0] : null
}

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
    // A public address into one of our vendored repositories names its source in
    // the owner and repository, not the host - every one of them shares the same
    // host. Read the source from there, so moving these collectors from a local
    // path to a public address did not cost them their licence.
    const submoduleName = submoduleNameForPublicAddress(uri)
    if (submoduleName) return submoduleName
    // A public address into a live-fetched (non-submodule) source's own
    // repository — currently only web3icons — names its source the same way.
    const liveGithubSource = liveGithubSourceKeyForPublicAddress(uri)
    if (liveGithubSource) return liveGithubSource
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
 * Which registered source, if any, verifiably owns the artwork at this address —
 * the address itself falls inside that source's `ownArtwork` location, not merely
 * inside a repository or path the source's provider key happens to be recorded
 * against. Returns `null` for an address that resolves to no registry entry, or
 * that resolves to one with no artwork of its own (ethereum-lists).
 *
 * This is the one check `resolveAttribution` and `effectiveEntryLicense` both
 * build on, so an address is never trusted as "some source's own artwork" two
 * different ways.
 */
export function sourceOwningAddress(uri: string | null | undefined): SourceLicense | null {
  const normalized = normalizeSourceUri(uri)
  if (!normalized) return null
  const key = sourceKeyFromUri(normalized)
  if (!key) return null
  const entry = SOURCE_REGISTRY[key]
  return entry?.ownArtwork ? entry : null
}

/**
 * The registry entry for a provider key, or `null` when the key is absent or
 * unregistered. Used by `insertList` to default a list's licence from its
 * provider, and by `resolveAttribution` to look up what a provider key CLAIMS
 * before deciding whether the address backs that claim up.
 */
export function sourceLicenseForProviderKey(providerKey: string | null | undefined): SourceLicense | null {
  if (!providerKey) return null
  return SOURCE_REGISTRY[providerKey] ?? null
}

/**
 * Decide the EFFECTIVE licence of one list_token entry, at collection time —
 * the only moment a collector holds both the list and the address it used.
 *
 * 1. The list's own licence, but ONLY for an address that verifies as its own
 *    provider's own artwork — never for an address the list merely points at.
 * 2. Otherwise, an address that independently verifies as some OTHER known
 *    source's own artwork (a LiFi entry pointing into trustwallet/assets, for
 *    example) earns THAT source's licence.
 * 3. Otherwise `null` — unknown, never guessed.
 *
 * A matched source whose own licence is `'unknown'` never reaches either rule:
 * there is nothing to grant. See `sourceOwningAddress` for the address check.
 */
export function effectiveEntryLicense({
  listProviderKey,
  listLicense,
  imageAddress,
}: {
  listProviderKey: string | null | undefined
  listLicense: string | null | undefined
  imageAddress: string | null | undefined
}): string | null {
  const owning = sourceOwningAddress(imageAddress)
  const ownEntry = sourceLicenseForProviderKey(listProviderKey)
  if (listLicense && owning && ownEntry && owning.sourceKey === ownEntry.sourceKey) {
    return listLicense
  }
  if (owning && owning.license !== 'unknown') {
    return owning.license
  }
  return null
}

/**
 * Resolve the licence and attribution for one served image when no precomputed
 * `list_token.license` is available — a row collected before this column
 * existed, or a route with no list context at all (a network icon, or the
 * content-addressed route).
 *
 * A provider key is never trusted for its licence alone. A `'unknown'` claim
 * costs nothing to surface (there is no permission being over-claimed), so it
 * is returned unconditionally; a REAL licence claim is returned only once the
 * address itself verifies as that same source's own artwork — exactly
 * `effectiveEntryLicense`'s rule 1, applied without a list to draw the claim
 * from. Failing that, the address may still independently verify as some other
 * known source's own artwork (rule 2). Otherwise, unknown.
 */
export function resolveAttribution({
  providerKey,
  uri,
}: {
  providerKey?: string | null
  uri?: string | null
}): SourceLicense {
  const claimed = sourceLicenseForProviderKey(providerKey)
  if (claimed) {
    if (claimed.license === 'unknown') return claimed
    const owning = sourceOwningAddress(uri)
    if (owning && owning.sourceKey === claimed.sourceKey) return claimed
    // A real licence claimed by the provider key alone, with no address
    // confirming it is that provider's own artwork, is exactly the
    // ethereum-lists defect this guards against — never granted.
  }
  const owning = sourceOwningAddress(uri)
  if (owning) return owning
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
 * Resolve the source to publish headers for, preferring a precomputed
 * `list_token.license` (the entry's EFFECTIVE licence, decided once at
 * collection time with full knowledge of the address the list actually used)
 * over the legacy provider-key/uri guesswork `resolveAttribution` falls back to
 * for a row collected before that column existed, or a route with no list_token
 * at all.
 *
 * The stored licence is the authoritative fact; only its url/attribution need
 * re-deriving, since those are not columns of their own. The current address is
 * tried first (freshest, independently verifiable), then the list's own
 * registered licence, and if neither still lines up with the stored value the
 * licence is still reported — computed once, correctly, it does not need
 * re-justifying — just without a url or attribution to accompany it.
 */
function resolveEffectiveSource({
  uri,
  providerKey,
  entryLicense,
  listLicense,
  listLicenseUrl,
  listAttribution,
}: {
  uri?: string | null
  providerKey?: string | null
  entryLicense?: string | null
  listLicense?: string | null
  listLicenseUrl?: string | null
  listAttribution?: string | null
}): SourceLicense {
  if (!entryLicense) {
    return resolveAttribution({ providerKey, uri })
  }
  const owning = sourceOwningAddress(uri)
  if (owning && owning.license === entryLicense) {
    return owning
  }
  if (listLicense && listLicense === entryLicense) {
    return Object.freeze({
      sourceKey: providerKey || 'list',
      name: (providerKey && SOURCE_REGISTRY[providerKey]?.name) || null,
      license: entryLicense,
      licenseUrl: listLicenseUrl ?? null,
      attribution: listAttribution ?? null,
      ownArtwork: null,
    })
  }
  return Object.freeze({
    sourceKey: providerKey || 'unknown',
    name: null,
    license: entryLicense,
    licenseUrl: null,
    attribution: null,
    ownArtwork: null,
  })
}

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
  entryLicense,
  listLicense,
  listLicenseUrl,
  listAttribution,
}: {
  uri?: string | null
  providerKey?: string | null
  /** The list_token row's precomputed effective licence, when one is known. */
  entryLicense?: string | null
  /** The owning list's own registered licence, for url/attribution enrichment. */
  listLicense?: string | null
  listLicenseUrl?: string | null
  listAttribution?: string | null
}): Record<string, string> {
  const source = resolveEffectiveSource({
    uri,
    providerKey,
    entryLicense,
    listLicense,
    listLicenseUrl,
    listAttribution,
  })
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
