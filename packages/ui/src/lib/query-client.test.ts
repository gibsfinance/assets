/**
 * The single query client the whole interface shares.
 *
 * Every page reads through this one instance, so its defaults are the caching policy for
 * the entire site: how long a fetched token list stays fresh, how long it survives in
 * memory after nothing is rendering it, and whether returning to the tab re-fetches.
 * Those numbers are invisible at every call site — a change here would show up only as
 * extra network traffic or as stale data on screen, never as a failing render — so they
 * are pinned as a contract.
 */
import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryClient } from './query-client'

describe('shared query client', () => {
  it('is a query client the whole application can share', () => {
    expect(queryClient).toBeInstanceOf(QueryClient)
  })

  it('keeps fetched data fresh for five minutes before refetching', () => {
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(5 * 60 * 1000)
  })

  it('holds unused data in memory for an hour, so navigating back is instant', () => {
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(60 * 60 * 1000)
  })

  it('retries a failed request once rather than hammering the server', () => {
    // Zero would surface every transient blip to the visitor; the library default of
    // three multiplies load during an outage.
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(1)
  })

  it('does not refetch merely because the window regained focus', () => {
    // Token lists are large and change rarely. Refetching on focus turns tab switching
    // into repeated multi-megabyte downloads.
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
  })
})
