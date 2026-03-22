import { useState, useCallback, useRef } from 'react'
import type { ListDescription, Network, PlatformMetrics, Token, TokenInfo } from '../types'
import { getApiUrl } from '../utils'

interface CacheEntry<T> {
  timestamp: number
  data: T
  compressed?: boolean
}

interface TokenChunk {
  startIndex: number
  tokens: TokenInfo[]
}

const CACHE_DURATION = 3 * 60 * 60 * 1000 // 3 hours in milliseconds
const MAX_ENTRY_SIZE = 500 * 1024 // 500KB for a single entry
const CHUNK_SIZE = 500 // Reduced chunk size
const MAX_CHUNKS_PER_LIST = 5 // Limit total chunks per list
const MINIMUM_TOKENS_FOR_CHUNKING = 1000 // Only chunk if more than 1000 tokens

function isCacheValid<T>(cache: CacheEntry<T> | null): cache is CacheEntry<T> {
  if (!cache) return false
  return Date.now() - cache.timestamp < CACHE_DURATION
}

function chunkTokenList(tokens: TokenInfo[]): TokenChunk[] {
  const chunks: TokenChunk[] = []
  for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
    chunks.push({
      startIndex: i,
      tokens: tokens.slice(i, i + CHUNK_SIZE),
    })
  }
  return chunks
}

function filterAndCompressTokens(tokens: TokenInfo[]): TokenInfo[] {
  return tokens.map((token) => ({
    chainId: token.chainId,
    address: token.address.toLowerCase(),
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
  }))
}

function getFromCache<T>(key: string): T | null {
  try {
    // Check for chunked token list
    if (key.startsWith('tokenList_')) {
      const metaKey = `${key}_meta`
      const meta = localStorage.getItem(metaKey)

      if (meta) {
        const {
          data: { chunks },
        } = JSON.parse(meta)
        const allTokens: TokenInfo[] = []

        // Collect all available chunks
        for (let i = 0; i < chunks; i++) {
          try {
            const chunkKey = `${key}_chunk_${i}`
            const chunkData = localStorage.getItem(chunkKey)
            if (!chunkData) continue

            const chunk: CacheEntry<TokenChunk> = JSON.parse(chunkData)
            if (isCacheValid(chunk)) {
              allTokens.push(...chunk.data.tokens)
            }
          } catch (error) {
            console.warn(`Failed to read chunk ${i}`, error)
          }
        }

        if (allTokens.length > 0) {
          return allTokens as T
        }
      }
    }

    // Regular cache handling
    const cached = localStorage.getItem(key)
    if (!cached) return null

    const parsedCache: CacheEntry<T> = JSON.parse(cached)
    return isCacheValid(parsedCache) ? parsedCache.data : null
  } catch (error) {
    console.warn(`Failed to read cache for ${key}`, error)
    return null
  }
}

function setToCache<T>(key: string, data: T): void {
  try {
    // Special handling for token lists
    if (key.startsWith('tokenList_') && Array.isArray(data)) {
      const tokens = data as TokenInfo[]

      // Only chunk if we have a large number of tokens
      if (tokens.length > MINIMUM_TOKENS_FOR_CHUNKING) {
        // Compress tokens first
        const compressedTokens = filterAndCompressTokens(tokens)
        const chunks = chunkTokenList(compressedTokens)

        // Limit number of chunks to prevent excessive storage usage
        const limitedChunks = chunks.slice(0, MAX_CHUNKS_PER_LIST)

        let successfulChunks = 0
        limitedChunks.forEach((chunk, index) => {
          const chunkKey = `${key}_chunk_${index}`
          try {
            const chunkEntry: CacheEntry<TokenChunk> = {
              timestamp: Date.now(),
              data: {
                startIndex: chunk.startIndex,
                tokens: chunk.tokens,
              },
            }

            const serialized = JSON.stringify(chunkEntry)
            if (serialized.length <= MAX_ENTRY_SIZE) {
              localStorage.setItem(chunkKey, serialized)
              successfulChunks++
            }
          } catch (error) {
            console.warn(`Skipping chunk ${index} due to storage error`, error)
          }
        })

        // Only store metadata if we successfully stored some chunks
        if (successfulChunks > 0) {
          const metaEntry = {
            timestamp: Date.now(),
            data: {
              totalTokens: tokens.length,
              storedTokens: successfulChunks * CHUNK_SIZE,
              chunks: successfulChunks,
            },
          }
          try {
            localStorage.setItem(`${key}_meta`, JSON.stringify(metaEntry))
          } catch (error) {
            console.warn('Failed to store chunk metadata', error)
          }
        }
        return
      }
    }

    // Regular cache handling for non-token-list data or small token lists
    const cacheEntry: CacheEntry<T> = {
      timestamp: Date.now(),
      data: data,
    }

    try {
      const serialized = JSON.stringify(cacheEntry)
      if (serialized.length <= MAX_ENTRY_SIZE) {
        localStorage.setItem(key, serialized)
      }
    } catch (error) {
      console.warn(`Failed to cache ${key}`, error)
    }
  } catch (error) {
    console.warn(`Error preparing cache entry for ${key}`, error)
  }
}

function clearCacheEntries(): void {
  try {
    const keys = Object.keys(localStorage)
    const cacheKeys = keys.filter(
      (key) => key.startsWith('tokenList_') || key === 'providers' || key === 'networks',
    )

    cacheKeys.forEach((key) => {
      localStorage.removeItem(key)
      // Also remove any associated chunks
      if (key.startsWith('tokenList_')) {
        keys
          .filter((k) => k.startsWith(`${key}_chunk_`))
          .forEach((chunkKey) => localStorage.removeItem(chunkKey))
        localStorage.removeItem(`${key}_meta`)
      }
    })
    console.log('Cache cleared successfully')
  } catch (error) {
    console.error('Error clearing cache:', error)
  }
}

export type MetricsHookResult = {
  metrics: PlatformMetrics | null
  providers: ListDescription[]
  isLoading: boolean
  fetchMetrics: (forceFresh?: boolean) => Promise<void>
  fetchTokenList: (provider: string) => Promise<Token[] | null>
  fetchProviders: () => Promise<ListDescription[]>
  clearCache: () => void
}

export function useMetrics(): MetricsHookResult {
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(() => {
    // Load cached metrics immediately on init so all pages see data
    try {
      const raw = localStorage.getItem('metrics')
      if (!raw) return null
      const entry = JSON.parse(raw) as CacheEntry<PlatformMetrics>
      if (isCacheValid(entry)) return entry.data
    } catch { /* ignore parse errors */ }
    return null
  })
  const [providers, setProviders] = useState<ListDescription[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const isLoadingRef = useRef(false)

  const fetchTokenList = useCallback(async (provider: string): Promise<Token[] | null> => {
    const cacheKey = `tokenList_${provider}`
    const cachedData = getFromCache<Token[]>(cacheKey)
    if (cachedData) {
      return cachedData
    }

    try {
      const response = await fetch(getApiUrl(`/list/${provider}`))
      if (!response.ok) {
        if (response.status !== 404) {
          console.error(`Failed to fetch list ${provider}, status: ${response.status}`)
        }
        return []
      }
      const data = (await response.json()) as { tokens: Token[] }
      const tokens = data.tokens || []

      if (tokens.length > 0) {
        console.log(`Fetched ${tokens.length} tokens from ${provider}`)
      }

      setToCache(cacheKey, tokens)
      return tokens
    } catch (error) {
      console.error(`Failed to fetch ${provider} list:`, error)
      return []
    }
  }, [])

  const fetchProviders = useCallback(async (): Promise<ListDescription[]> => {
    const cacheKey = 'providers'
    const cachedData = getFromCache<ListDescription[]>(cacheKey)

    if (cachedData) {
      setProviders(cachedData)
      return cachedData
    }

    try {
      const response = await fetch(getApiUrl('/list'))
      if (!response.ok) return []
      const result = (await response.json()) as ListDescription[]
      setToCache(cacheKey, result)
      setProviders(result)
      return result
    } catch (error) {
      console.error('Failed to fetch providers:', error)
      return []
    }
  }, [])

  const fetchNetworks = useCallback(async (): Promise<string[]> => {
    const cacheKey = 'networks'
    const cachedData = getFromCache<string[]>(cacheKey)

    if (cachedData) {
      return cachedData
    }

    try {
      const response = await fetch(getApiUrl('/networks'))
      if (!response.ok) {
        return []
      }
      const networks = (await response.json()) as Network[]
      console.log(networks)
      const values = networks.filter((n) => n.type === 'evm').map((network) => network.chainId)
      setToCache(cacheKey, values)
      return values
    } catch (error) {
      console.error('Failed to fetch networks:', error)
      return []
    }
  }, [])

  const fetchMetrics = useCallback(
    async (forceFresh = false): Promise<void> => {
      if (isLoadingRef.current) return
      isLoadingRef.current = true
      setIsLoading(true)

      try {
        // Check cache first unless forceFresh is true
        if (!forceFresh) {
          const cachedMetrics = getFromCache<PlatformMetrics>('metrics')
          if (cachedMetrics) {
            setMetrics(cachedMetrics)
            return
          }
        } else {
          // Only clear cache if forceFresh is true
          console.log('Force refreshing metrics, clearing cache...')
          clearCacheEntries()
        }

        // Fetch available networks and providers
        const [_networks, providers] = await Promise.all([fetchNetworks(), fetchProviders()])
        void _networks // consumed for side-effect caching

        // Get unique provider keys, prioritizing certain providers
        const priorityProviders = ['coingecko', 'uniswap-uniswap-default-list']
        const uniqueProviders = [
          ...new Set(
            providers
              .sort((a, b) => {
                const aIndex = priorityProviders.indexOf(a.providerKey)
                const bIndex = priorityProviders.indexOf(b.providerKey)
                if (aIndex !== -1 && bIndex === -1) return -1
                if (aIndex === -1 && bIndex !== -1) return 1
                if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
                return 0
              })
              .map((p) => p.providerKey),
          ),
        ]

        console.log('Fetching token lists from providers:', uniqueProviders)

        // Fetch all token lists in parallel
        const allTokenLists = await Promise.all(
          uniqueProviders.map(async (provider) => {
            const tokens = await fetchTokenList(provider)
            return tokens ?? []
          }),
        )

        // Create a map to store unique tokens per chain
        const tokensByChain: Record<string, Map<string, TokenInfo>> = {}

        // Process all tokens from all lists
        for (const tokenList of allTokenLists) {
          for (const token of tokenList) {
            if (!token.chainId || !token.address) continue

            const chainId = token.chainId.toString()
            const address = token.address.toLowerCase()

            if (!tokensByChain[chainId]) {
              tokensByChain[chainId] = new Map()
            }

            tokensByChain[chainId].set(address, token)
          }
        }

        // Count tokens by chain
        const byChain: Record<string, number> = {}
        for (const [chainId, tokens] of Object.entries(tokensByChain)) {
          const count = tokens?.size || 0
          byChain[chainId] = count
          console.log(`Chain ${chainId}: ${count} tokens`)
        }

        // Calculate total
        const total = Object.values(byChain).reduce((sum, count) => sum + count, 0)

        const computedMetrics: PlatformMetrics = {
          tokenList: {
            total,
            byChain,
          },
          networks: {
            supported: Object.keys(byChain).map((chainId: string) => ({
              chainId: parseInt(chainId),
              name: `Chain ${chainId}`,
              isActive: chainId === '369',
            })),
            active: 'PulseChain',
          },
        }

        // Cache the computed metrics
        console.log('metrics', computedMetrics)
        setToCache('metrics', computedMetrics)
        setMetrics(computedMetrics)
      } catch (error) {
        console.error('Failed to fetch metrics:', error)
        setMetrics({
          tokenList: {
            total: 0,
            byChain: {},
          },
          networks: {
            supported: [],
            active: 'PulseChain',
          },
        })
      } finally {
        isLoadingRef.current = false
        setIsLoading(false)
      }
    },
    [fetchNetworks, fetchProviders, fetchTokenList],
  )

  const clearCache = useCallback(() => {
    clearCacheEntries()
  }, [])

  return { metrics, providers, isLoading, fetchMetrics, fetchTokenList, fetchProviders, clearCache }
}
