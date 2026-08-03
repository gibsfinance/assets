export interface TokenInfo {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
}

export interface TokenListReference {
  sourceList: string
  imageUri: string
  imageFormat: string
}

export interface Token extends TokenInfo {
  hasIcon: boolean
  sourceList: string
  /**
   * Namespaced chain identifier the token was listed under, e.g. `solana-501`.
   * `chainId` carries the bare number that the token list format mandates, and a
   * bare number names no namespace — eleven of them are claimed by two, so
   * deriving an identifier from it silently assumes Ethereum-Virtual-Machine.
   * Set it wherever the namespace is known; read it via `tokenChainIdentifier`.
   */
  chainIdentifier?: string
  isBridgeToken?: boolean
  chainName?: string
  listReferences?: TokenListReference[]
}

export type ApiType = 'token' | 'network' | 'list'

export type PositionType = 'back' | 'middle' | 'front'

export type Hex = `0x${string}`

export type FloatingToken = {
  type?: ApiType
  chainId?: number
  address?: Hex
  size: number
  speed: number
  delay: number
  direction: number
  layer: PositionType
  startPos: number
}

export interface NetworkInfo {
  chainId: number
  chainIdentifier: string
  type: string
  name: string
  /** Resolved once in useMetrics from the registry's name and title. */
  isTestnet: boolean
  tokenCount: number
  hasImage: boolean
  isEvm: boolean
}

export interface PlatformMetrics {
  tokenList: {
    total: number
  }
  networks: {
    /** Per-chain token counts live on each entry's `tokenCount`, keyed by namespace. */
    supported: NetworkInfo[]
  }
}

/**
 * What the search box tells the browser panel: the term as typed, and the
 * outcome of searching every chain for it.
 */
export type SearchUpdate = {
  /** Exactly what is in the box, untrimmed — the local filter matches on it. */
  query: string
  /** True while the request is out, so the panel can keep showing the local filter. */
  isSearching: boolean
  isError: boolean
  /**
   * More tokens matched than were returned. The search stops at a candidate cap,
   * so the count past that point is genuinely unknown and there is no total to
   * report — this is the honest signal that the list on screen is not all of it.
   */
  truncated: boolean
  tokens: Token[]
}

export type ListDescription = {
  key: string
  name: string
  description: string
  default: boolean
  providerKey: string
  chainId: string
  chainType: string
}

export type Network = {
  type: string
  chainId: string
  networkId: string
  chainIdentifier: string
  /** Registry name from the server; null when no collector had one for this chain. */
  name: string | null
  /** The registry's prose label; null on the ~89% of chains that ship none. */
  title: string | null
  imageHash: string | null
}

export interface CodeBlockProps {
  code?: string
  lang?: 'console' | 'html' | 'css' | 'js'
  theme?: 'dark-plus'
  // Base Style Props
  base?: string
  rounded?: string
  shadow?: string
  classes?: string
  // Pre Style Props
  preBase?: string
  prePadding?: string
  preClasses?: string
}

export interface StudioAppearance {
  width: number
  height: number
  shape: 'circle' | 'rounded' | 'square'
  borderRadius: number
  padding: number
  shadow: 'none' | 'subtle' | 'medium' | 'strong'
  backgroundColor: string
}

export interface BadgeConfig {
  enabled: boolean
  angleDeg: number
  sizeRatio: number
  overlap: number
  ringEnabled: boolean
  ringColor: string
  ringThickness: number
  badgeShape?: 'circle' | 'square'
  badgePadding?: number
  badgeBackground?: string
}

export type CodeFormat = 'sdk' | 'react' | 'html' | 'img'
export type CodeMode = 'snippet' | 'component'

export interface ImageMetadata {
  format: string
  width: number | null
  height: number | null
  fileSize: number | null
  contentType: string
}
