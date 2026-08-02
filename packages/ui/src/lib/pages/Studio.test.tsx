/**
 * The Studio page's contract with the URL: `?chain=` and `?token=` ARE the
 * navigational state, so a link someone shares or a tab someone reloads has to
 * come back to the same place.
 *
 * `?token=` was written on every selection and never read, which no unit test
 * could have caught — the defect was a missing effect, not a wrong one. These
 * render the page and assert what the studio ends up selecting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return { ...actual, getApiUrl: (path: string) => `https://api.test${path}` }
})

// The sibling panels pull in the virtualizer, the list editor, and IndexedDB.
// None of that participates in URL hydration; a probe reporting what the studio
// selected is the whole assertion.
vi.mock('../components/StudioBrowser', () => ({ default: () => createElement('div', null, 'browser') }))
vi.mock('../components/ListEditor', () => ({ default: () => createElement('div', null, 'editor') }))
vi.mock('../components/TokenDetailModal', () => ({ default: () => null }))

// The list editor persists to IndexedDB, which jsdom does not provide.
const idbStore = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: (key: string) => Promise.resolve(idbStore.get(key)),
  set: (key: string, value: unknown) => {
    idbStore.set(key, value)
    return Promise.resolve()
  },
  del: (key: string) => {
    idbStore.delete(key)
    return Promise.resolve()
  },
  keys: () => Promise.resolve([...idbStore.keys()]),
}))
vi.mock('../components/BottomDrawer', () => ({
  default: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))
vi.mock('../components/StudioConfigurator', async () => {
  const { useStudio } = await import('../contexts/StudioContext')
  return {
    default: () => {
      const { selectedToken, selectedChainId } = useStudio()
      return createElement(
        'div',
        null,
        createElement('span', { 'data-testid': 'selected-chain' }, selectedChainId ?? 'none'),
        createElement('span', { 'data-testid': 'selected-token' }, selectedToken?.symbol ?? 'none'),
        createElement('span', { 'data-testid': 'selected-namespace' }, selectedToken?.chainIdentifier ?? 'none'),
      )
    },
  }
})

import Studio from './Studio'
import { StudioProvider } from '../contexts/StudioContext'
import { ListEditorProvider } from '../contexts/ListEditorContext'
import { SettingsProvider } from '../contexts/SettingsContext'

const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const TOKENS: Record<string, unknown> = {
  'solana-501': {
    chainId: 501,
    total: 1,
    tokens: [
      {
        chainId: 501,
        address: SOLANA_USDC,
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        logoURI: 'https://logo/usdc.png',
        sources: ['jupiter/tag-strict'],
      },
    ],
  },
  'eip155-1': {
    chainId: 1,
    total: 1,
    tokens: [
      {
        chainId: 1,
        // Checksummed here; the URL below carries it lowercased.
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        name: 'USD Coin',
        symbol: 'USDC-ETH',
        decimals: 6,
        logoURI: 'https://logo/usdc.png',
        sources: ['gib/default'],
      },
    ],
  },
}

function installFetch() {
  mockFetch.mockImplementation((input: string) => {
    const url = String(input)
    const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    const match = url.match(/\/list\/tokens\/([^/?]+)/)
    if (match) return ok(TOKENS[match[1]] ?? { chainId: 0, total: 0, tokens: [] })
    if (url.endsWith('/stats')) return ok([])
    if (url.endsWith('/networks')) return ok([])
    return ok([])
  })
}

function renderStudio(initialUrl: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [initialUrl] },
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          SettingsProvider,
          null,
          createElement(StudioProvider, null, createElement(ListEditorProvider, null, createElement(Studio))),
        ),
      ),
    ),
  )
}

/** Studio renders the configurator in both the desktop panel and the mobile drawer. */
const probe = (testId: string) => screen.getAllByTestId(testId)[0].textContent

beforeEach(() => {
  mockFetch.mockReset()
  localStorage.clear()
  installFetch()
})
afterEach(cleanup)

describe('Studio URL hydration', () => {
  it('restores the chain from ?chain=', async () => {
    renderStudio('/studio?chain=solana-501')
    await waitFor(() => expect(probe('selected-chain')).toBe('solana-501'))
  })

  it('restores the selected token from ?token=', async () => {
    renderStudio(`/studio?chain=solana-501&token=${SOLANA_USDC}`)
    await waitFor(() => expect(probe('selected-token')).toBe('USDC'))
  })

  // The restored token has to remember which namespace it came from, or every
  // image URL and generated snippet built from it names the wrong chain.
  it('restores it with the namespace it was listed under', async () => {
    renderStudio(`/studio?chain=solana-501&token=${SOLANA_USDC}`)
    await waitFor(() => expect(probe('selected-namespace')).toBe('solana-501'))
    expect(probe('selected-chain')).toBe('solana-501')
  })

  // Ethereum-Virtual-Machine addresses are checksummed in some lists and
  // lowercased in others, and links get lowercased in transit.
  it('matches the address case-insensitively', async () => {
    renderStudio('/studio?chain=eip155-1&token=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
    await waitFor(() => expect(probe('selected-token')).toBe('USDC-ETH'))
  })

  it('leaves the token unselected when the address is not on the chain', async () => {
    renderStudio('/studio?chain=solana-501&token=NotATokenOnThisChain')
    await waitFor(() => expect(probe('selected-chain')).toBe('solana-501'))
    expect(probe('selected-token')).toBe('none')
  })

  it('selects nothing when the URL names no chain', async () => {
    renderStudio('/studio')
    await waitFor(() => expect(probe('selected-chain')).toBe('none'))
    expect(probe('selected-token')).toBe('none')
  })
})
