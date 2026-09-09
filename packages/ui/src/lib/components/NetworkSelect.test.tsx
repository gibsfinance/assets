import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { NetworkInfo } from '../types'

// ---------------------------------------------------------------------------
// Virtualizer mock — @tanstack/react-virtual measures real layout, which jsdom
// does not provide, so the production virtualizer mounts zero rows. This
// stand-in maps every item to a virtual row so assertions run against the rows
// the component chose to render. Same pattern as StudioBrowser.test.tsx.
//
// The stand-in is wrapped in `vi.fn` so a test can read back the options the
// component passed in — the row count, the row height estimate, and the
// overscan — without changing what it renders for every other test.
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
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
  })),
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

  /*
   * The clear button sits beside the trigger that opens the drawer, laid over
   * its right edge. It used to sit inside it, which no parser accepts: a
   * browser closes the outer button early and rebuilds the tree, so the button
   * that renders is not the one the source describes. Being a sibling is also
   * what makes clearing a selection stop there instead of opening the drawer
   * on the same click - a click never reaches an element it is not inside.
   */
  describe('clear selection', () => {
    it('keeps every button out of every other button, which a browser will not do for us', () => {
      // The structural claim, held separately from the behavioural ones below.
      // Those would go on passing if the clear button moved back inside the
      // trigger and something stopped the click again, so they cannot speak for
      // the markup. React reports this nesting on every render with a selection.
      renderNetworkSelect({ selectedChainId: '1' })

      const buttons = [...document.querySelectorAll('button')]
      expect(buttons.length).toBeGreaterThan(1)
      const nested = buttons.filter((button) => button.parentElement?.closest('button'))
      expect(nested).toEqual([])
    })

    it('does not show a clear button when there is no selection to clear', () => {
      renderNetworkSelect({ selectedChainId: null })

      expect(screen.queryByLabelText('Clear network selection')).toBeNull()
    })

    it('reports no network selected when the clear button is clicked', () => {
      const onSelect = vi.fn()
      renderNetworkSelect({ selectedChainId: '1', onSelect })

      fireEvent.click(screen.getByLabelText('Clear network selection'))

      expect(onSelect).toHaveBeenCalledWith(null)
    })

    it('does not open the network list when the click only clears the selection', () => {
      renderNetworkSelect({ selectedChainId: '1' })

      fireEvent.click(screen.getByLabelText('Clear network selection'))

      expect(screen.queryByLabelText('Search networks')).toBeNull()
    })
  })

  /*
   * The drawer puts Ethereum and PulseChain first because those are the
   * networks most people using this tool care about — everything else sorts
   * by name. A user hunting for Ethereum in a list of hundreds of networks
   * either finds it at the top or gives up looking.
   *
   * Each test below renders its own small network list through a fresh
   * `useMetrics` mock rather than reusing the file-level one, so the input
   * order reaching the comparator can be controlled precisely.
   */
  describe('priority chain ordering', () => {
    afterEach(() => {
      vi.doUnmock('../hooks/useMetrics')
      vi.resetModules()
    })

    function makeNetwork(fields: Pick<NetworkInfo, 'chainId' | 'chainIdentifier' | 'name'>): NetworkInfo {
      return {
        type: 'evm',
        tokenCount: 1,
        hasImage: true,
        isEvm: true,
        isTestnet: false,
        ...fields,
      }
    }

    const ethereum = makeNetwork({ chainId: 1, chainIdentifier: 'eip155-1', name: 'Ethereum' })
    const pulsechain = makeNetwork({ chainId: 369, chainIdentifier: 'eip155-369', name: 'PulseChain' })
    const avalanche = makeNetwork({ chainId: 43114, chainIdentifier: 'eip155-43114', name: 'Avalanche' })
    const bitcoin = makeNetwork({ chainId: 0, chainIdentifier: 'bip122-0', name: 'Bitcoin' })

    async function renderedOrder(networks: NetworkInfo[]): Promise<string[]> {
      vi.resetModules()
      vi.doMock('../hooks/useMetrics', () => ({
        useMetrics: () => ({
          metrics: { networks: { supported: networks }, tokenList: { total: networks.length } },
          providers: [],
          isLoading: false,
        }),
      }))

      const { default: FreshNetworkSelect } = await import('./NetworkSelect')
      render(createElement(FreshNetworkSelect, { selectedChainId: null, onSelect: vi.fn() }))
      fireEvent.click(screen.getByText('Choose a network...'))

      const rows = document.querySelectorAll('div.overflow-y-auto button')
      return Array.from(rows).map((row) => row.textContent ?? '')
    }

    it('puts a priority chain ahead of a non-priority chain', async () => {
      const order = await renderedOrder([bitcoin, ethereum])

      expect(order[0]).toContain('Ethereum')
      expect(order[1]).toContain('Bitcoin')
    })

    it('keeps a non-priority chain behind a priority chain', async () => {
      // Same claim as above, checked from a source list in the opposite
      // order, since the comparator carries the two directions as separate
      // return statements — either one alone can regress independently.
      const order = await renderedOrder([ethereum, bitcoin])

      expect(order[0]).toContain('Ethereum')
      expect(order[1]).toContain('Bitcoin')
    })

    it('orders two priority chains by their place in the priority list, not by name', async () => {
      // PulseChain also sorts after Ethereum alphabetically, so listing it
      // first in the source data proves the priority list decides the order
      // here, not the alphabetical fallback.
      const order = await renderedOrder([pulsechain, ethereum])

      expect(order[0]).toContain('Ethereum')
      expect(order[1]).toContain('PulseChain')
    })

    it('sorts two non-priority chains alphabetically by name', async () => {
      const order = await renderedOrder([bitcoin, avalanche])

      expect(order[0]).toContain('Avalanche')
      expect(order[1]).toContain('Bitcoin')
    })
  })

  /*
   * The network list is virtualized because the drawer can carry over 1,900
   * networks — mounting a row per network would mean thousands of Document
   * Object Model nodes and image elements. In this test environment the
   * scroll container has no measured height, so the real virtualizer mounts
   * zero rows regardless of list size; that path is covered by the mock
   * documented above, not by these tests. What these tests pin instead is
   * the configuration the component hands to the virtualizer — the values
   * that decide how many rows exist around the visible area and how big
   * each one is assumed to be.
   */
  describe('virtual scroller configuration', () => {
    const openDrawer = () => fireEvent.click(screen.getByText('Choose a network...'))
    const search = (value: string) => fireEvent.change(screen.getByLabelText('Search networks'), { target: { value } })

    it('estimates each row at a fixed height and keeps rows mounted outside the viewport for scrolling', async () => {
      renderNetworkSelect()
      openDrawer()
      await screen.findByText('Ethereum')

      const lastCall = vi.mocked(useVirtualizer).mock.calls.at(-1)?.[0] as {
        estimateSize: (index: number) => number
        overscan: number
      }

      // A wrong estimate here does not match the fixed row height in the
      // markup, so the virtualizer's scroll math and the rows painted on
      // screen disagree, producing gaps or overlap while scrolling.
      expect(lastCall.estimateSize(0)).toBe(45)
      // Overscan keeps rows mounted just past the visible edge; dropping it
      // to zero would flash empty space during a fast scroll.
      expect(lastCall.overscan).toBeGreaterThan(0)
    })

    it('feeds the virtualizer the filtered row count once a search narrows the list', async () => {
      renderNetworkSelect()
      openDrawer()
      await screen.findByText('Ethereum')

      const fullListCall = vi.mocked(useVirtualizer).mock.calls.at(-1)?.[0] as { count: number }
      expect(fullListCall.count).toBe(2)

      search('bitcoin')
      await screen.findByText('Bitcoin')

      // If the virtualizer were still told about the full, unfiltered list,
      // it would size and position rows for networks the search hid.
      const filteredCall = vi.mocked(useVirtualizer).mock.calls.at(-1)?.[0] as { count: number }
      expect(filteredCall.count).toBe(1)
    })
  })
})
