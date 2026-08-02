import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { createElement } from 'react'

// ---------------------------------------------------------------------------
// Virtualizer mock — @tanstack/react-virtual measures real layout, which jsdom
// does not provide, so the production virtualizer mounts zero rows. This
// stand-in maps every item to a virtual row so assertions run against the rows
// the component chose to render. Same pattern as StudioBrowser.test.tsx.
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 45,
    getVirtualItems: () =>
      Array.from({ length: count }, (_unused, index) => ({
        index,
        key: index,
        start: index * 45,
        size: 45,
      })),
    measure: () => {},
    measureElement: () => {},
  }),
}))

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
      tokenList: { total: 100 },
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

  /*
   * The drawer lists every supported network — over 1,900 of them — with no way
   * to narrow it. Reaching anything past the first screen meant scrolling a
   * list that mounted all of them at once.
   */
  describe('search', () => {
    const openDrawer = () => fireEvent.click(screen.getByText('Choose a network...'))
    const search = (value: string) => fireEvent.change(screen.getByLabelText('Search networks'), { target: { value } })

    it('narrows the list to matching networks', async () => {
      renderNetworkSelect()
      openDrawer()

      search('bitcoin')

      expect(await screen.findByText('Bitcoin')).toBeTruthy()
      expect(screen.queryByText('Ethereum')).toBeNull()
    })

    it('finds a network by its identifier', async () => {
      renderNetworkSelect()
      openDrawer()

      search('bip122')

      expect(await screen.findByText('Bitcoin')).toBeTruthy()
      expect(screen.queryByText('Ethereum')).toBeNull()
    })

    it('finds an Ethereum-Virtual-Machine network by its chain number', async () => {
      renderNetworkSelect()
      openDrawer()

      search('1')

      expect(await screen.findByText('Ethereum')).toBeTruthy()
    })

    it('says so rather than showing an empty panel when nothing matches', async () => {
      renderNetworkSelect()
      openDrawer()

      search('zzzz')

      expect(await screen.findByText(/No networks match/i)).toBeTruthy()
    })

    it('picking a filtered result still selects by identifier', async () => {
      const onSelect = vi.fn()
      renderNetworkSelect({ onSelect })
      openDrawer()

      search('bitcoin')
      fireEvent.click(await screen.findByText('Bitcoin'))

      expect(onSelect).toHaveBeenCalledWith('bip122-0')
    })

    // Reopening should start from the full list, not from whatever was typed
    // last time — otherwise the drawer looks broken on the second visit.
    it('clears the query when the drawer is reopened', async () => {
      renderNetworkSelect()
      openDrawer()
      search('bitcoin')
      expect(screen.queryByText('Ethereum')).toBeNull()

      fireEvent.click(await screen.findByText('Bitcoin'))
      openDrawer()

      expect(await screen.findByText('Ethereum')).toBeTruthy()
    })
  })

  /**
   * The scroll offset is owned jointly by the scroll container and the
   * virtualizer's own state, and closing the drawer unmounts neither. Scrolling
   * 8,000 pixels into the 52,000-pixel list, closing, and reopening brought the
   * drawer back mid-alphabet under a freshly cleared search box that claimed to
   * be listing all 1,900 networks. Typing was worse: the ranked list rebuilt
   * beneath a stale offset, so the best match for the query being typed rendered
   * thousands of pixels above the viewport.
   *
   * Both are fixed by remounting the list whenever it becomes a different list,
   * which is what these assert — a remounted list cannot carry an old offset.
   * Resetting from an effect was tried first and does not work: on open it runs
   * before the panel's DOM exists, and moving the container without the
   * virtualizer desynchronizes them into a drawer that paints nothing at all.
   */
  describe('scroll position', () => {
    const openDrawer = () => fireEvent.click(screen.getByText('Choose a network...'))
    const closeDrawer = () => fireEvent.keyDown(document, { key: 'Escape' })
    const search = (value: string) => fireEvent.change(screen.getByLabelText('Search networks'), { target: { value } })
    const scroller = () => document.querySelector<HTMLElement>('div.overflow-y-auto')

    it('reopens at the top of the list rather than where the last visit left off', async () => {
      renderNetworkSelect()
      openDrawer()

      const scrolled = scroller()
      expect(scrolled).toBeTruthy()
      scrolled!.scrollTop = 8000

      closeDrawer()
      openDrawer()
      await screen.findByText('Ethereum')

      expect(scroller()!.scrollTop).toBe(0)
    })

    it('returns to the top when a search rebuilds the list, so the best match is on screen', async () => {
      renderNetworkSelect()
      openDrawer()

      const scrolled = scroller()
      scrolled!.scrollTop = 8000

      search('bitcoin')
      await screen.findByText('Bitcoin')

      expect(scroller()!.scrollTop).toBe(0)
    })

    it('leaves the offset alone while the same list is being scrolled', async () => {
      // The reset must key on the list changing, not fire on every render — a
      // drawer that snapped back to the top mid-scroll would be unusable.
      renderNetworkSelect()
      openDrawer()
      await screen.findByText('Ethereum')

      const list = scroller()!
      list.scrollTop = 8000
      fireEvent.scroll(list)

      expect(scroller()!.scrollTop).toBe(8000)
    })
  })
})
