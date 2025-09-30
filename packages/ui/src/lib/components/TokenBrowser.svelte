<script lang="ts">
  import Image from './Image.svelte'
  import PaginationControls from './PaginationControls.svelte'
  import type { Token } from '../types'
  import { getApiUrl } from '../utils'
  import Icon from '@iconify/svelte'
  import type { Snippet } from 'svelte'
  import _ from 'lodash'

  type Props = {
    networkName: string
    filteredTokens?: Token[]
    isCircularCrop?: boolean
    currentPage: number
    tokensPerPage: number
    onselecttoken: (t: Token) => void
    onperpageupdate: (perPage: number) => void
    onpagechange: (pageNumber: number) => void
    children: Snippet
  }

  const {
    // selectedChain = null,
    networkName,
    filteredTokens = [],
    isCircularCrop = false,
    // isListFilterOpen = false,
    currentPage = 1,
    tokensPerPage = 25,
    // getNetworkName,
    onselecttoken,
    onperpageupdate,
    onpagechange,
    children,
  }: Props = $props()
</script>

<div class="card variant-ghost flex flex-col gap-2">
  <!-- Chain Token Count Header -->
  <!-- <div class="flex items-center justify-between">
      <span class="font-medium">
        {filteredTokens.length}
        {filteredTokens.length === 1 ? 'token' : 'tokens'} on {networkName}
      </span>
    </div> -->

  <!-- Search and filter slot -->
  {@render children?.()}

  {#if filteredTokens.length === 0}
    <div class="p-4 text-center text-gray-500"> Loading tokens... </div>
  {:else}
    <!-- Token Table with responsive design -->
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Symbol</th>
            <th>Network</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody class="[&>tr]:hover:preset-tonal-primary">
          {#each filteredTokens.slice((currentPage - 1) * tokensPerPage, currentPage * tokensPerPage) as token}
            <tr
              class="cursor-pointer transition-colors hover:bg-[#00DC82]/10 dark:hover:bg-[#00DC82]/20"
              onclick={() => onselecttoken(token)}>
              <td class="p-1">
                <div class="flex items-center gap-2">
                  <div
                    class="relative flex h-10 min-h-[40px] w-10 min-w-[40px] items-center justify-center {isCircularCrop
                      ? 'rounded-full'
                      : ''}">
                    {#if token.hasIcon}
                      <Image
                        src={getApiUrl(`/image/${token.chainId}/${token.address}`)}
                        alt={token.symbol}
                        class="user-drag-none object-contain {isCircularCrop ? 'rounded-full' : ''}"
                        size={32}
                        onerror={() => {
                          token.hasIcon = false
                          // Force Svelte to update this token in the list
                          // todo: make sure that this still works appropriately
                          // filteredTokens = [...filteredTokens]
                        }} />
                    {:else}
                      <Icon icon="nrk:404" class="h-8 w-8 text-surface-50" />
                    {/if}
                  </div>
                  <div class="flex flex-col" title={token.sourceList}>
                    <span class="font-medium whitespace-pre overflow-hidden text-ellipsis">{token.name}</span>
                  </div>
                </div>
              </td>
              <td title={token.symbol} class="px-1">
                <span>{token.symbol}</span>
              </td>
              <td title={networkName} class="px-1">
                <span class="text-sm">{networkName}</span>
              </td>
              <td title={token.address} class="px-1">
                <code class="text-xs">{token.address}</code>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <!-- Horizontal scroll indicator for small screens -->
      <div class="horizontal-scroll-hint">
        <span class="text-xs text-surface-500 md:hidden">← Swipe horizontally to see more details →</span>
      </div>
    </div>

    <!-- Pagination -->
    <div class="py-2 px-4">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <span class="text-sm text-surface-600 dark:text-surface-300">Show</span>
          <select
            class="select !h-7 !py-0 text-sm"
            value={tokensPerPage}
            onchange={(e) => {
              const target = e.target as HTMLSelectElement
              const value = Number(target.value)
              onperpageupdate(value)
            }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span class="text-sm text-surface-600 dark:text-surface-300">tokens</span>
        </div>
        <PaginationControls {currentPage} totalItems={filteredTokens.length} {tokensPerPage} {onpagechange} />
      </div>
    </div>
  {/if}
</div>
<!--
<style lang="postcss">
  /* Added comment to explain responsive table changes */
  /* TokenBrowser.svelte updated on 08/16/2024 to make table fully scrollable on mobile screens */

  .table-container {
    width: 100%;
    overflow-x: auto;
    position: relative;
  }

  .token-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
  }

  /* Apply minimum width on smaller screens for proper scrolling */
  @media (max-width: 768px) {
    .token-table {
      min-width: 700px; /* Ensure table has minimum width for scrolling on small screens */
    }
  }

  .token-table th,
  .token-table td {
    padding: 0.5rem;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Responsive column widths */
  .token-table th:nth-child(1),
  .token-table td:nth-child(1) {
    width: 35%;
  }

  .token-table th:nth-child(2),
  .token-table td:nth-child(2) {
    width: 15%;
  }

  .token-table th:nth-child(3),
  .token-table td:nth-child(3) {
    width: 35%;
  }

  .token-table th:nth-child(4),
  .token-table td:nth-child(4) {
    width: 15%;
  }

  /* Horizontal scroll hint */
  .horizontal-scroll-hint {
    text-align: center;
    padding: 0.25rem 0;
  }

  /* .spinner {
    @apply mx-auto h-8 w-8 rounded-full border-4 border-primary-500/20 border-t-primary-500;
    animation: spin 1s linear infinite;
  } */

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style> -->
