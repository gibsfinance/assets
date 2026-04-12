import { useQuery } from '@tanstack/react-query'
import type { ListDescription, Network, PlatformMetrics, Token } from '../types'
import { getApiUrl } from '../utils'

// ---------------------------------------------------------------------------
// Fetch functions (exported for testing)
// ---------------------------------------------------------------------------

export async function fetchStats(): Promise<{ chainId: string; count: number }[]> {
  const response = await fetch(getApiUrl('/stats'))
  if (!response.ok) return []
  return (await response.json()) as { chainId: string; count: number }[]
}

export async function fetchProvidersList(): Promise<ListDescription[]> {
  const response = await fetch(getApiUrl('/list'))
  if (!response.ok) return []
  return (await response.json()) as ListDescription[]
}

export async function fetchNetworksList(): Promise<Network[]> {
  const response = await fetch(getApiUrl('/networks'))
  if (!response.ok) return []
  return (await response.json()) as Network[]
}

export async function fetchTokenListByProvider(provider: string): Promise<Token[]> {
  const response = await fetch(getApiUrl(`/list/${provider}`))
  if (!response.ok) return []
  const data = (await response.json()) as { tokens: Token[] }
  return data.tokens ?? []
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** Server-authoritative per-chain token counts */
export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    staleTime: 3 * 60 * 60 * 1000, // 3 hours
  })
}

/** All available list providers */
export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: fetchProvidersList,
    staleTime: 3 * 60 * 60 * 1000,
  })
}

/** All supported networks */
export function useNetworks() {
  return useQuery({
    queryKey: ['networks'],
    queryFn: fetchNetworksList,
    staleTime: 3 * 60 * 60 * 1000,
  })
}

/** Token list for a single provider */
export function useTokenList(provider: string | null) {
  return useQuery({
    queryKey: ['tokenList', provider],
    queryFn: () => fetchTokenListByProvider(provider!),
    enabled: !!provider,
    staleTime: 3 * 60 * 60 * 1000,
  })
}

// ---------------------------------------------------------------------------
// Derived composite hook — replaces the old useMetrics / MetricsContext shape
// ---------------------------------------------------------------------------

/**
 * Combines stats + networks to produce the PlatformMetrics shape that Home,
 * StudioBrowser, NetworkSelect, and TokenSearch expect.
 *
 * Also exposes `providers` for consumers that previously accessed it via context.
 */
export function useMetrics(): {
  metrics: PlatformMetrics | null
  providers: ListDescription[]
  isLoading: boolean
} {
  const { data: stats, isLoading: statsLoading } = useStats()
  const { data: networks, isLoading: networksLoading } = useNetworks()
  const { data: providers, isLoading: providersLoading } = useProviders()

  const isLoading = statsLoading || networksLoading || providersLoading

  if (!stats || !networks) {
    return { metrics: null, providers: providers ?? [], isLoading }
  }

  const evmNetworks = networks.filter((n) => n.type === 'evm')

  const byChain: Record<string, number> = {}
  for (const { chainId, count } of stats) {
    byChain[chainId] = count
  }
  const total = Object.values(byChain).reduce((sum, c) => sum + c, 0)

  const supported = evmNetworks
    .filter((n) => byChain[n.chainId] !== undefined)
    .map((n) => ({
      chainId: Number(n.chainId),
      name: `Chain ${n.chainId}`,
      isActive: n.chainId === '369',
    }))

  const metrics: PlatformMetrics = {
    tokenList: { total, byChain },
    networks: { supported, active: 'PulseChain' },
  }

  return { metrics, providers: providers ?? [], isLoading }
}
