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
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter, Link } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Token } from '../types'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return { ...actual, getApiUrl: (path: string) => `https://api.test${path}` }
})

// The sibling panels pull in the virtualizer, the list editor, and IndexedDB.
// None of that participates in URL hydration; a probe reporting what the studio
// selected is the whole assertion. The chain/token/inspect callbacks Studio
// passes down are exposed as buttons so tests can drive them the way a real
// browser click would, without pulling in the virtualizer.
vi.mock('../components/StudioBrowser', () => ({
  default: ({
    onInspectToken,
    selectChain,
    selectToken,
  }: {
    onInspectToken: (token: Token) => void
    selectChain?: (chainId: string | null) => void
    selectToken?: (token: Token) => void
  }) =>
    createElement(
      'div',
      null,
      'browser',
      createElement(
        'button',
        { onClick: () => selectChain?.('eip155-137'), 'data-testid': 'browser-select-chain' },
        'select chain',
      ),
      createElement(
        'button',
        { onClick: () => selectChain?.(null), 'data-testid': 'browser-clear-chain' },
        'clear chain',
      ),
      createElement(
        'button',
        { onClick: () => selectToken?.(BASE_TOKEN), 'data-testid': 'browser-select-token' },
        'select token',
      ),
      createElement(
        'button',
        { onClick: () => onInspectToken(BASE_TOKEN), 'data-testid': 'browser-inspect-token' },
        'inspect token',
      ),
    ),
}))
vi.mock('../components/ListEditor', async () => {
  const { useListEditor } = await import('../contexts/ListEditorContext')
  return {
    default: () => {
      const { isOpen, editingListId, editingSourceKey } = useListEditor()
      return createElement(
        'div',
        null,
        createElement('span', { 'data-testid': 'editor-open' }, String(isOpen)),
        createElement('span', { 'data-testid': 'editor-list-id' }, editingListId ?? 'none'),
        createElement('span', { 'data-testid': 'editor-source-key' }, editingSourceKey ?? 'none'),
      )
    },
  }
})
vi.mock('../components/TokenDetailModal', () => ({
  default: ({ token, onClose }: { token: Token | null; onClose: () => void }) =>
    token
      ? createElement('button', { onClick: onClose, 'data-testid': 'modal-close' }, `inspecting ${token.symbol}`)
      : null,
}))

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

// A token the mocked StudioBrowser hands back through selectToken/onInspectToken,
// standing in for whatever the real browser would have picked.
const BASE_TOKEN: Token = {
  chainId: 8453,
  address: '0xBaseToken00000000000000000000000000001',
  name: 'Base Token',
  symbol: 'BASE',
  decimals: 18,
  hasIcon: true,
  sourceList: 'gib/default',
  chainIdentifier: 'eip155-8453',
}

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
          createElement(
            StudioProvider,
            null,
            createElement(
              ListEditorProvider,
              null,
              createElement(Studio),
              // A plain link into the same router, so a test can drop the URL back to
              // `/studio` and observe how Studio reacts to a param disappearing —
              // something calling renderStudio again with a new URL cannot exercise,
              // since that mounts a fresh page rather than transitioning an existing one.
              createElement(Link, { to: '/studio' }, 'go to /studio'),
            ),
          ),
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

describe('Studio editor URL hydration', () => {
  it('opens a fresh editor from ?editor=new', async () => {
    renderStudio('/studio?editor=new')
    await waitFor(() => expect(probe('editor-open')).toBe('true'))
    expect(probe('editor-list-id')).toBe('none')
  })

  it('opens the named list from ?editor=<id>', async () => {
    renderStudio('/studio?editor=my-list-id')
    await waitFor(() => expect(probe('editor-open')).toBe('true'))
    expect(probe('editor-list-id')).toBe('my-list-id')
  })

  // The editor's own state has no memory of the URL it was opened from — only
  // this effect closes it back down. If it stopped watching for the param's
  // removal, a reader who navigated "back" to a plain /studio link would find
  // the editor still covering the screen.
  it('closes the editor once its URL param is gone', async () => {
    renderStudio('/studio?editor=new')
    await waitFor(() => expect(probe('editor-open')).toBe('true'))

    fireEvent.click(screen.getByText('go to /studio'))

    await waitFor(() => expect(probe('editor-open')).toBe('false'))
    expect(probe('editor-list-id')).toBe('none')
  })
})

describe('Studio chain and token selection write back to the URL', () => {
  // If this callback forgot to push the chain into the URL, the browser's
  // selection would work for the current render only — reloading, or sharing
  // the link, would silently drop back to whatever chain was there before.
  it('selecting a chain in the browser is reflected by the URL round-trip into context', async () => {
    renderStudio('/studio')
    await waitFor(() => expect(probe('selected-chain')).toBe('none'))

    fireEvent.click(screen.getAllByTestId('browser-select-chain')[0])

    await waitFor(() => expect(probe('selected-chain')).toBe('eip155-137'))
  })

  // Clearing the chain has to drop the token param too — a token belongs to
  // exactly one chain, so leaving `token=` behind would have the next chain
  // hydration effect try to match an address against the wrong chain's list.
  it('clearing the chain also clears the previously selected token', async () => {
    renderStudio(`/studio?chain=eip155-1&token=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`)
    await waitFor(() => expect(probe('selected-token')).toBe('USDC-ETH'))

    fireEvent.click(screen.getAllByTestId('browser-clear-chain')[0])

    await waitFor(() => expect(probe('selected-chain')).toBe('none'))
    expect(probe('selected-token')).toBe('none')
  })

  // selectToken updates context synchronously, ahead of the URL round-trip —
  // the configurator must not sit on the previous token while the URL catches up.
  it('selecting a token updates the configurator immediately, and its own chain with it', async () => {
    renderStudio('/studio')

    fireEvent.click(screen.getAllByTestId('browser-select-token')[0])

    expect(probe('selected-token')).toBe(BASE_TOKEN.symbol)
    expect(probe('selected-chain')).toBe(BASE_TOKEN.chainIdentifier)
    expect(probe('selected-namespace')).toBe(BASE_TOKEN.chainIdentifier)
  })
})

describe('Studio testnet toggle', () => {
  it('flips its own label and title when clicked', async () => {
    renderStudio('/studio')
    await screen.findAllByTitle('Testnets hidden')

    fireEvent.click(screen.getAllByTitle('Testnets hidden')[0])

    await waitFor(() => expect(screen.getAllByTitle('Testnets visible').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Hide testnets').length).toBeGreaterThan(0)
  })
})

describe('Studio token inspection modal', () => {
  // Inspecting a token from the browser, then dismissing the modal, has to
  // return to "nothing inspected" — otherwise the modal would either never
  // open (a wiring bug in onInspectToken) or never close (a wiring bug in
  // onClose), and a reader would be stuck looking at a stale token forever.
  it('opens the modal for the inspected token, and closing it clears the selection', async () => {
    renderStudio('/studio')
    expect(screen.queryByTestId('modal-close')).toBeNull()

    fireEvent.click(screen.getAllByTestId('browser-inspect-token')[0])
    await waitFor(() => expect(screen.getByTestId('modal-close').textContent).toBe('inspecting BASE'))

    fireEvent.click(screen.getByTestId('modal-close'))

    await waitFor(() => expect(screen.queryByTestId('modal-close')).toBeNull())
  })
})
