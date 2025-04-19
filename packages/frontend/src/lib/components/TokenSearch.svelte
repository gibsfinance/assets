<script lang="ts">
  import _ from 'lodash'
  import promiseLimit from 'promise-limit'
  import type { FormEventHandler } from 'svelte/elements'

  import { getApiUrl } from '../utils'
  import { metrics } from '../stores/metrics.svelte'
  import type { ListDescription, SearchUpdate, Token } from '../types'
  import TokenListFilter from './TokenListFilter.svelte'

  type SearchUpdateExtension = Partial<SearchUpdate>
  type Props = {
    onsearchupdate: (state: SearchUpdate) => void
    count: number
    networkName: string
    // filter props
    selectedChain: number | null
    onupdateopen: (open: boolean) => void
    ontogglelist: (listId: string, enabled: boolean) => void
    ontoggleall: (enabled: boolean) => void
  }

  const {
    onsearchupdate,
    count,
    networkName,
    // filter props
    selectedChain,
    onupdateopen,
    ontoggleall,
    ontogglelist,
  }: Props = $props()

  let isSearching = $state(false)
  let isGlobalSearching = $state(false)
  let query = $state('')

  let searchAbortController: AbortController | null = null

  const updateOutside = (update?: SearchUpdateExtension) => {
    onsearchupdate({
      query,
      isSearching,
      isGlobalSearching,
      tokens: [],
      isError: false,
      ...update,
    })
  }

  const limiter = promiseLimit<ListDescription>(4)

  const sortAndUpdateOutside = (globalSearchResults: Token[]) => {
    // Remove duplicates and update results
    const tokens = _.uniqBy(globalSearchResults, (t) => `${t.chainId}-${t.address.toLowerCase()}`)

    // Sort results
    tokens.sort((a, b) => {
      // Ethereum chain first
      if (a.chainId.toString() === '1' && b.chainId.toString() !== '1') return -1
      if (a.chainId.toString() !== '1' && b.chainId.toString() === '1') return 1
      // Then by name
      return a.name.localeCompare(b.name)
    })

    updateOutside({ tokens })
  }

  const performGlobalSearch = async () => {
    // Cancel any previous ongoing search
    if (searchAbortController) {
      searchAbortController.abort()
    }
    // Create new abort controller for this search
    searchAbortController = new AbortController()

    isGlobalSearching = true
    isSearching = true
    updateOutside({ tokens: [] })
    const searchTerm = query.toLowerCase()

    let globalSearchResults: Token[] = []
    try {
      // Split lists into global and chain-specific
      const response = await fetch(getApiUrl('/list'))
      if (!response.ok) {
        updateOutside({ isError: true })
        return
      }

      const lists = (await response.json()) as ListDescription[]
      const availableLists = lists.filter((list) => list.chainType === 'evm')
      const globalLists = availableLists.filter((list) => list.chainId === '0')
      const chainSpecificLists = availableLists.filter((list) => list.chainId !== '0')

      // First, fetch all global lists (these contain tokens for all chains)
      for (const list of globalLists) {
        try {
          const url = getApiUrl(`/list/${list.providerKey}/${list.key}`)
          console.log('Fetching global list:', url)
          const response = await fetch(url, {
            signal: searchAbortController.signal,
          })

          if (response.ok) {
            const data = await response.json()
            if (data?.tokens && Array.isArray(data.tokens)) {
              const matchingTokens = data.tokens
                .filter(
                  (token: any) =>
                    token.name.toLowerCase().includes(searchTerm) ||
                    token.symbol.toLowerCase().includes(searchTerm) ||
                    token.address.toLowerCase().includes(searchTerm),
                )
                .map((token: any) => ({
                  ...token,
                  hasIcon: true,
                  sourceList: `${list.providerKey}/${list.key}`,
                  isBridgeToken: list.providerKey.includes('bridge'),
                  chainName:
                    metrics.value?.networks.supported.find((n) => n.chainId.toString() === token.chainId.toString())
                      ?.name || `Chain ${token.chainId}`,
                }))

              if (matchingTokens.length > 0) {
                globalSearchResults = [...globalSearchResults, ...matchingTokens]
              }
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            console.log('Search aborted')
            return
          }
          console.error(`Error searching global list ${list.providerKey}/${list.key}:`, error)
        }
        updateOutside({ tokens: globalSearchResults })
      }

      // Then, fetch chain-specific lists
      // for (const list of chainSpecificLists) {
      await limiter.map(chainSpecificLists, async (list: ListDescription) => {
        if (!searchAbortController) {
          return
        }
        try {
          const url = getApiUrl(`/list/${list.providerKey}/${list.key}`)
          console.log('Fetching chain-specific list:', url)
          const response = await fetch(url, {
            signal: searchAbortController!.signal,
          })

          if (!response.ok) {
            return
          }

          const data = (await response.json()) as { tokens: Token[] }
          const tokens = data?.tokens && Array.isArray(data.tokens) && data.tokens
          if (!tokens) {
            return
          }
          const matchingTokens = tokens
            .filter(
              (token) =>
                token.name.toLowerCase().includes(searchTerm) ||
                token.symbol.toLowerCase().includes(searchTerm) ||
                token.address.toLowerCase().includes(searchTerm),
            )
            .map((token) => ({
              ...token,
              hasIcon: true,
              sourceList: `${list.providerKey}/${list.key}`,
              isBridgeToken: list.providerKey.includes('bridge'),
              chainName:
                metrics.value?.networks.supported.find((n) => n.chainId.toString() === token.chainId.toString())
                  ?.name || `Chain ${token.chainId}`,
            }))

          if (matchingTokens.length > 0) {
            globalSearchResults = [...globalSearchResults, ...matchingTokens]
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            console.log('Search aborted')
            return
          }
          // Only log non-404 errors
          if (error instanceof Error && !error.message.includes('404')) {
            console.error(`Error searching chain-specific list ${list.providerKey}/${list.key}:`, error)
            return
          }
        }
        sortAndUpdateOutside(globalSearchResults)
      })
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Global search error:', error)
      }
    } finally {
      isSearching = false
    }
    updateOutside({
      tokens: globalSearchResults,
    })
  }

  const handleInput: FormEventHandler<HTMLInputElement> = (e) => {
    if (isGlobalSearching) return
    query = e.currentTarget.value
    updateOutside()
  }
</script>

<div class="flex flex-col gap-2 sm:flex-row">
  <!-- Search bar -->
  <div
    class="input-group input-group-divider flex-1 grid-cols-[auto_1fr_auto] rounded-t-lg rounded-b-none flex flex-row items-center gap-2">
    <div class="input-group-shim">
      <i class="fas fa-search"></i>
    </div>
    <input
      type="search"
      placeholder="Search {count} tokens on {networkName}..."
      class="input !border-none !ring-0 !focus:ring-0 !focus:border-none"
      value={query}
      oninput={handleInput} />
    <TokenListFilter {selectedChain} {ontoggleall} {ontogglelist} {onupdateopen} />
    <button
      class="input-group-shim variant-soft-primary flex gap-2 items-center"
      type="button"
      onclick={performGlobalSearch}
      class:cursor-not-allowed={!query}
      disabled={!query}>
      <i class="fas fa-globe"></i>
      <span class="hidden sm:flex whitespace-pre">Search</span>
    </button>
  </div>
</div>
