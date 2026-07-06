import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { createElement } from 'react'

// ---------------------------------------------------------------------------
// Image mock — render a plain <img> so network rows do not trigger real
// network image loads. Mirrors the pattern in StudioBrowser.test.tsx.
// ---------------------------------------------------------------------------
vi.mock('./Image', () => ({
  default: ({ src, alt }: { src: string; alt?: string }) => createElement('img', { src, alt: alt ?? '' }),
}))

// ---------------------------------------------------------------------------
// Deterministic API base so image src assertions are predictable, matching
// the pattern used in StudioBrowser.test.tsx.
// ---------------------------------------------------------------------------
vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return {
    ...actual,
    getApiUrl: (path: string) => `https://api.test${path}`,
  }
})

// ---------------------------------------------------------------------------
// useMetrics mock — one Ethereum-Virtual-Machine network and one
// non-Ethereum-Virtual-Machine network, keyed by canonical chainIdentifier.
// ---------------------------------------------------------------------------
vi.mock('../hooks/useMetrics', () => ({
  useMetrics: () => ({
    metrics: {
      networks: {
        supported: [
          {
            chainId: 1,
            chainIdentifier: 'eip155-1',
            type: 'evm',
            name: 'Ethereum',
            tokenCount: 100,
            hasImage: true,
            isEvm: true,
          },
          {
            chainId: 0,
            chainIdentifier: 'bip122-0',
            type: 'bip122',
            name: 'Bitcoin',
            tokenCount: 0,
            hasImage: true,
            isEvm: false,
          },
        ],
      },
      tokenList: { total: 100, byChain: {} },
    },
    providers: [],
    isLoading: false,
  }),
}))

import NetworkSelect from './NetworkSelect'
import { SettingsProvider } from '../contexts/SettingsContext'

function renderNetworkSelect(props: Partial<Parameters<typeof NetworkSelect>[0]> = {}) {
  const onSelect = props.onSelect ?? vi.fn()
  return render(
    createElement(SettingsProvider, null, createElement(NetworkSelect, { selectedChainId: null, onSelect, ...props })),
  )
}

describe('NetworkSelect', () => {
  afterEach(() => {
    cleanup()
  })

  it('lists a non-Ethereum-Virtual-Machine chain and selects it by identifier', async () => {
    const onSelect = vi.fn()
    renderNetworkSelect({ onSelect })

    fireEvent.click(screen.getByText('Choose a network...'))
    fireEvent.click(await screen.findByText('Bitcoin'))

    expect(onSelect).toHaveBeenCalledWith('bip122-0')
  })

  it('shows the identifier for a non-Ethereum-Virtual-Machine row instead of "Chain 0"', async () => {
    renderNetworkSelect()

    fireEvent.click(screen.getByText('Choose a network...'))

    expect(await screen.findByText('bip122-0')).toBeTruthy()
    expect(screen.queryByText('Chain 0')).toBeNull()
  })

  it('still resolves a bare numeric selection from an old bookmark or preference', () => {
    // '1' must match the network whose identifier is 'eip155-1' so returning
    // users with a stored bare chain id keep seeing the selected network.
    renderNetworkSelect({ selectedChainId: '1' })

    expect(screen.getByText('Ethereum')).toBeTruthy()
    expect(screen.queryByText('Choose a network...')).toBeNull()
  })
})
