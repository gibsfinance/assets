/**
 * Behavioral tests for TokenListFilter.
 *
 * This panel lets a visitor narrow the token browser down to the lists that
 * still matter for the chain they are looking at. Every count on screen must
 * describe the chain in view, not the raw shape of the data the parent
 * passed in. A count that silently falls back to the total number of lists,
 * or to the total number of tokens, would tell a visitor that a list still
 * matters for this chain when it does not.
 *
 * The search box and the "Toggle All" button add a second layer: once a
 * visitor narrows the panel with a search term, every action inside the
 * panel must act on what is visible, not on the full set underneath it.
 *
 * The panel renders through a Headless User Interface Popover with an
 * anchored panel, so its content mounts in a portal at the end of the
 * document body rather than inside the render container. Queries below use
 * `screen`, which searches the whole document, instead of scoping to the
 * container the popover button sits in.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import TokenListFilter from './TokenListFilter'
import type { Token } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let nextAddress = 1

/** A minimal token on the given chain. Each call gets its own address. */
function tokenOn(chainId: number): Token {
  const address = `0x${String(nextAddress++).padStart(40, '0')}`
  return {
    chainId,
    address,
    name: 'Token',
    symbol: 'TOK',
    decimals: 18,
    hasIcon: true,
    sourceList: 'list',
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Overrides = {
  selectedChain?: number | null
  enabledLists?: Set<string>
  tokensByList?: Map<string, Token[]>
}

function renderFilter(overrides: Overrides = {}) {
  const onToggleList = vi.fn()
  const onToggleAll = vi.fn()
  const props = {
    selectedChain: overrides.selectedChain === undefined ? 1 : overrides.selectedChain,
    enabledLists: overrides.enabledLists ?? new Set<string>(),
    tokensByList: overrides.tokensByList ?? new Map<string, Token[]>(),
    onToggleList,
    onToggleAll,
  }
  const view = render(<TokenListFilter {...props} />)
  const rerenderWith = (next: Partial<typeof props>) => view.rerender(<TokenListFilter {...props} {...next} />)
  return { ...view, onToggleList, onToggleAll, rerenderWith }
}

/** The button that opens the panel — found by its icon, since it carries no label. */
const filterButton = (container: HTMLElement) => container.querySelector('.fa-filter')!.closest('button')!

/** The number shown on the button itself. */
const badgeCount = (container: HTMLElement) => container.querySelector('.fa-filter')!.nextElementSibling!.textContent

const openPanel = (container: HTMLElement) => fireEvent.click(filterButton(container))

const searchInput = () => screen.getByPlaceholderText('Search lists...') as HTMLInputElement

const toggleAllButton = () => screen.getByRole('button', { name: 'Toggle All' })

/** The small checkbox square inside a list row's label, found by the list's own key text. */
const checkboxFor = (listKey: string) => screen.getByText(listKey).closest('label')!.firstElementChild as HTMLElement

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// The badge count
// ---------------------------------------------------------------------------

describe('the count on the button', () => {
  it('counts lists that hold a token on the selected chain, not every list', () => {
    // The most likely regression: reading tokensByList.size instead of the
    // filtered count. Three lists go in, only two hold a token on chain 1, and
    // the badge must say two — not three.
    const tokensByList = new Map<string, Token[]>([
      ['list-with-chain-one-a', [tokenOn(1)]],
      ['list-with-chain-one-b', [tokenOn(1)]],
      ['list-without-chain-one', [tokenOn(369)]],
    ])
    const { container } = renderFilter({ selectedChain: 1, tokensByList })

    expect(badgeCount(container)).toBe('2')
  })

  it('shows zero when no chain is selected, even though lists exist', () => {
    // A token never carries a null chain id, so comparing every token's chain
    // id against a null selection can only ever fail to match. Pinning this
    // so a future change to that comparison does not silently start counting
    // every list once no chain is chosen.
    const tokensByList = new Map<string, Token[]>([
      ['list-a', [tokenOn(1)]],
      ['list-b', [tokenOn(369)]],
    ])
    const { container } = renderFilter({ selectedChain: null, tokensByList })

    expect(badgeCount(container)).toBe('0')

    // Opening the panel with no chain selected must show no rows at all,
    // rather than falling back to every list in tokensByList.
    openPanel(container)
    expect(screen.queryByText('list-a')).toBeNull()
    expect(screen.queryByText('list-b')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Per-list token counts
// ---------------------------------------------------------------------------

describe('the token count on each list row', () => {
  it('counts only the tokens on the selected chain, not the whole list', () => {
    const list = [tokenOn(1), tokenOn(1), tokenOn(369), tokenOn(369), tokenOn(369)]
    const { container } = renderFilter({
      selectedChain: 1,
      tokensByList: new Map([['mixed-chain-list', list]]),
    })

    openPanel(container)

    expect(screen.getByText('2 tokens')).toBeTruthy()
    expect(screen.queryByText('5 tokens')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Reacting to a changed selected chain
// ---------------------------------------------------------------------------

describe('changing the selected chain', () => {
  it('recomputes both the badge and the visible lists for the new chain', () => {
    // Proves the chain id is a real dependency of the memoised filtering, not
    // just read once on mount. A missing dependency would leave the panel
    // showing the previous chain's lists after the visitor switches chains.
    const tokensByList = new Map<string, Token[]>([
      ['only-on-ethereum', [tokenOn(1)]],
      ['only-on-pulsechain', [tokenOn(369)]],
    ])
    const { container, rerenderWith } = renderFilter({ selectedChain: 1, tokensByList })

    expect(badgeCount(container)).toBe('1')
    openPanel(container)
    expect(screen.getByText('only-on-ethereum')).toBeTruthy()
    expect(screen.queryByText('only-on-pulsechain')).toBeNull()

    rerenderWith({ selectedChain: 369 })

    expect(badgeCount(container)).toBe('1')
    expect(screen.queryByText('only-on-ethereum')).toBeNull()
    expect(screen.getByText('only-on-pulsechain')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('searching the list names', () => {
  it('matches a substring anywhere in the name, regardless of letter case', () => {
    const tokensByList = new Map<string, Token[]>([
      ['uniswap-default', [tokenOn(1)]],
      ['coingecko-bridge-partner', [tokenOn(1)]],
      ['pulsechain-bridge-tokens', [tokenOn(1)]],
    ])
    const { container } = renderFilter({ selectedChain: 1, tokensByList })
    openPanel(container)

    fireEvent.change(searchInput(), { target: { value: 'BRIDGE' } })

    expect(screen.getByText('coingecko-bridge-partner')).toBeTruthy()
    expect(screen.getByText('pulsechain-bridge-tokens')).toBeTruthy()
    expect(screen.queryByText('uniswap-default')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Toggle All
// ---------------------------------------------------------------------------

describe('Toggle All', () => {
  it('reads only the filtered lists, so a hidden disabled list does not force it on', () => {
    // The subtlest behaviour in the component: handleToggleAll checks
    // filteredLists, the search-narrowed set, not every list under the chain.
    // With the search narrowed to two enabled lists, a third, hidden list
    // being disabled must not change what Toggle All decides to do.
    const tokensByList = new Map<string, Token[]>([
      ['search-match-one', [tokenOn(1)]],
      ['search-match-two', [tokenOn(1)]],
      ['other-list', [tokenOn(1)]],
    ])
    const enabledLists = new Set(['search-match-one', 'search-match-two'])
    const { container, onToggleAll } = renderFilter({ selectedChain: 1, tokensByList, enabledLists })
    openPanel(container)

    fireEvent.change(searchInput(), { target: { value: 'match' } })
    expect(screen.queryByText('other-list')).toBeNull()

    fireEvent.click(toggleAllButton())

    // Both visible lists are already enabled, so Toggle All turns them off —
    // it must not see the hidden, disabled "other-list" and decide to turn
    // everything on instead.
    expect(onToggleAll).toHaveBeenCalledWith(false)
    expect(onToggleAll).toHaveBeenCalledTimes(1)
  })

  it('turns everything on when at least one visible list is disabled', () => {
    const tokensByList = new Map<string, Token[]>([
      ['search-match-one', [tokenOn(1)]],
      ['search-match-two', [tokenOn(1)]],
      ['other-list', [tokenOn(1)]],
    ])
    // Only one of the two lists the search will show is enabled; "other-list"
    // is enabled too, but it stays hidden and must not affect the decision.
    const enabledLists = new Set(['search-match-one', 'other-list'])
    const { container, onToggleAll } = renderFilter({ selectedChain: 1, tokensByList, enabledLists })
    openPanel(container)

    fireEvent.change(searchInput(), { target: { value: 'match' } })
    fireEvent.click(toggleAllButton())

    expect(onToggleAll).toHaveBeenCalledWith(true)
  })
})

// ---------------------------------------------------------------------------
// Toggling one list
// ---------------------------------------------------------------------------

describe('toggling a single list', () => {
  it('turns an enabled list off with one call, and one call only', () => {
    // The checkbox square sits inside a label with no separate control of
    // its own, and a click on it must produce exactly one toggle. A second,
    // stray call here would flip a list on and back off in the same click.
    //
    // The handler also calls event.preventDefault(), which the component
    // comments describe as stopping the surrounding label from forwarding a
    // second click. Removing that call does not fail this test: the label
    // wraps two plain divs, not a real form control, so there is nothing in
    // the current markup for the browser (or jsdom) to forward a click to.
    // The call is still worth keeping — it costs nothing and guards against
    // a future change that gives the label a real control to forward to —
    // but this test cannot be the thing that proves it is load-bearing today.
    const tokensByList = new Map([['my-list', [tokenOn(1)]]])
    const enabledLists = new Set(['my-list'])
    const { container, onToggleList } = renderFilter({ selectedChain: 1, tokensByList, enabledLists })
    openPanel(container)

    fireEvent.click(checkboxFor('my-list'))

    expect(onToggleList).toHaveBeenCalledTimes(1)
    expect(onToggleList).toHaveBeenCalledWith('my-list', false)
  })

  it('turns a disabled list on with one call, and one call only', () => {
    const tokensByList = new Map([['my-list', [tokenOn(1)]]])
    const { container, onToggleList } = renderFilter({ selectedChain: 1, tokensByList, enabledLists: new Set() })
    openPanel(container)

    fireEvent.click(checkboxFor('my-list'))

    expect(onToggleList).toHaveBeenCalledTimes(1)
    expect(onToggleList).toHaveBeenCalledWith('my-list', true)
  })
})

// ---------------------------------------------------------------------------
// Lists with nothing on the selected chain
// ---------------------------------------------------------------------------

describe('a list with no tokens on the selected chain', () => {
  it('does not appear, even if the caller has it enabled', () => {
    // Being enabled is a stored preference; it says nothing about whether the
    // list has anything to show for the chain currently in view. A list with
    // zero matching tokens must stay off the panel regardless of that flag,
    // or a visitor would see and be able to toggle a list with nothing in it.
    const tokensByList = new Map<string, Token[]>([
      ['empty-on-this-chain', [tokenOn(369)]],
      ['has-a-token-here', [tokenOn(1)]],
    ])
    const enabledLists = new Set(['empty-on-this-chain', 'has-a-token-here'])
    const { container } = renderFilter({ selectedChain: 1, tokensByList, enabledLists })
    openPanel(container)

    expect(screen.queryByText('empty-on-this-chain')).toBeNull()
    expect(screen.getByText('has-a-token-here')).toBeTruthy()
  })
})
