import { useQuery } from '@tanstack/react-query'
import type { ListDescription, Network, NetworkInfo, PlatformMetrics, Token } from '../types'
import { getApiUrl } from '../utils'
import { getNetworkName } from '../utils/network-name'
import { isTestnet } from '../utils/is-testnet'

// ---------------------------------------------------------------------------
// Fetch functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Fetch JSON, treating a non-ok response as the failure it is.
 *
 * Each of these fetchers used to `return []` when the response was not ok. That
 * reads as defensive and is the opposite: an empty array is a successful
 * answer, so the query resolves, `isError` never becomes true, and every
 * consumer renders a confident zero for something it does not know. A failed
 * `/networks` said the platform supports no chains at all.
 *
 * The interface already had the honest state and could not reach it — Home
 * renders a dashed placeholder while `metrics` is null, but `[]` is truthy, so
 * metrics were always computed and the placeholder was dead on the error path.
 * Throwing leaves `data` undefined, which is what puts that branch back in
 * play, and lets React Query's retry absorb a transient failure on the way.
 */
async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(getApiUrl(path))
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

export async function fetchStats(): Promise<{ chainId: string; chainIdentifier: string; count: number }[]> {
  return fetchJson<{ chainId: string; chainIdentifier: string; count: number }[]>('/stats')
}

export async function fetchProvidersList(): Promise<ListDescription[]> {
  return fetchJson<ListDescription[]>('/list')
}

export async function fetchNetworksList(): Promise<Network[]> {
  return fetchJson<Network[]>('/networks')
}

export async function fetchTokenListByProvider(provider: string): Promise<Token[]> {
  const data = await fetchJson<{ tokens: Token[] }>(`/list/${provider}`)
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
  isError: boolean
} {
  const { data: stats, isLoading: statsLoading, isError: statsError } = useStats()
  const { data: networks, isLoading: networksLoading, isError: networksError } = useNetworks()
  const { data: providers, isLoading: providersLoading, isError: providersError } = useProviders()

  const isLoading = statsLoading || networksLoading || providersLoading
  // Published so a consumer can tell "still arriving" from "asked and failed".
  // Both leave `metrics` null, and they call for different words on screen.
  const isError = statsError || networksError || providersError

  if (!stats || !networks) {
    return { metrics: null, providers: providers ?? [], isLoading, isError }
  }

  // Token counts keyed on the canonical identifier so a non-Ethereum-Virtual-Machine
  // bare reference (e.g. monero-128) never inherits an Ethereum-Virtual-Machine
  // chain's count (e.g. Huobi chain 128). A bare-keyed map used to be published
  // alongside this one; every consumer that read it collided two namespaces onto
  // one number, so it is gone rather than deprecated.
  const byIdentifier: Record<string, number> = {}
  for (const { chainIdentifier, count } of stats) {
    byIdentifier[chainIdentifier] = count
  }
  const total = Object.values(byIdentifier).reduce((sum, c) => sum + c, 0)

  // Naming is resolved once, here, so a consumer can never re-derive it differently.
  // isTestnet reads the registry's raw name rather than the curated display one: the
  // curated maps rename chains for the drawer ("PulseChain Testnet v4" survives, but a
  // future entry might not), whereas upstream's own naming is what states the fact.
  const supported: NetworkInfo[] = networks.map((n) => {
    const name = getNetworkName(n.chainIdentifier, { registryName: n.name })
    return {
      chainId: Number(n.chainId),
      chainIdentifier: n.chainIdentifier,
      type: n.type,
      name,
      isTestnet: isTestnet({ name: n.name ?? name, title: n.title }),
      tokenCount: byIdentifier[n.chainIdentifier] ?? 0,
      hasImage: n.imageHash != null,
      isEvm: n.type === 'evm',
    }
  })

  const metrics: PlatformMetrics = {
    tokenList: { total },
    networks: { supported },
  }

  return { metrics, providers: providers ?? [], isLoading, isError }
}
