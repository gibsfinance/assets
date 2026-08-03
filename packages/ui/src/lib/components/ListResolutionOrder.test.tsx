/**
 * The provider priority list in the studio.
 *
 * Several providers publish an icon for the same token, and this order decides which one
 * the site serves — position one wins. Every failure here is a wrong logo rather than a
 * missing one: the page renders, the image loads, and it is simply the wrong project's
 * mark on the wrong token. Nothing throws and no request fails, so only assertions on the
 * resulting order can catch it.
 *
 * The second contract is the meaning of "default". When the order matches the server's own
 * order the component must publish null, not the equivalent array, because null is what
 * keeps the generated links free of a long redundant parameter. An array that happens to
 * equal the default looks identical on screen and produces different links.
 *
 * The ordering arithmetic lives in ../utils/list-order and is tested there. These cover the
 * component: what a drag, an arrow key and the reset button do to shared studio state, and
 * what survives a reload. The real StudioProvider is used — the persisted value is read
 * from localStorage, not from a spy. No application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import ListResolutionOrder from './ListResolutionOrder'
import { StudioProvider, useStudio } from '../contexts/StudioContext'
import { DEFAULT_PROVIDERS } from '../utils/list-order'

const STUDIO_STORAGE_KEY = 'gib-studio-state'

/** Surfaces the resolution order the studio is actually holding. */
function ResolutionProbe() {
  const { resolutionOrder } = useStudio()
  return <span data-testid="resolution-order">{JSON.stringify(resolutionOrder)}</span>
}

/** The order the rest of the studio reads: null means "use the server default". */
function readStudioOrder(): string[] | null {
  return JSON.parse(screen.getByTestId('resolution-order').textContent ?? 'null')
}

/** The order as shown, top to bottom — the priority a visitor sees. */
function readVisibleOrder(): string[] {
  return screen.getAllByRole('option').map((row) => row.querySelector('span:nth-child(2)')?.textContent ?? '')
}

const rowAt = (index: number) => screen.getAllByRole('option')[index]

const resetButton = () => screen.getByRole('button', { name: /Reset to default/ })

/** Renders the component and opens the collapsible panel, which mounts its rows lazily. */
function renderOpened() {
  const view = render(
    <StudioProvider>
      <ListResolutionOrder />
      <ResolutionProbe />
    </StudioProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Resolution Order/ }))
  return view
}

/** Seeds the studio preferences a previous visit would have left behind. */
function seedPersistedOrder(order: string[] | null) {
  localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify({ resolutionOrder: order }))
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('ListResolutionOrder', () => {
  it('opens on the server order, with the winning provider first', () => {
    renderOpened()
    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])
    expect(readStudioOrder()).toBeNull()
  })

  it('numbers each provider by its priority, so the ranking is readable', () => {
    renderOpened()
    const badges = screen.getAllByRole('option').map((row) => row.querySelector('span:nth-child(3)')?.textContent)
    expect(badges).toEqual(DEFAULT_PROVIDERS.map((_, index) => String(index + 1)))
  })

  it('reopens on the custom order a previous visit saved', () => {
    // The order is a preference, not navigational state: closing the tab must not quietly
    // hand the token back to whichever provider the server prefers.
    const saved = ['pulsex', ...DEFAULT_PROVIDERS.filter((p) => p !== 'pulsex')]
    seedPersistedOrder(saved)
    renderOpened()
    expect(readVisibleOrder()).toEqual(saved)
    expect(readStudioOrder()).toEqual(saved)
  })

  it('marks a custom order as custom, and the server order not at all', () => {
    seedPersistedOrder(['uniswap', ...DEFAULT_PROVIDERS.filter((p) => p !== 'uniswap')])
    renderOpened()
    expect(screen.queryByText('Custom')).toBeTruthy()
    cleanup()

    localStorage.clear()
    renderOpened()
    expect(screen.queryByText('Custom')).toBeNull()
  })

  it('promotes a dragged provider to the position it was dropped on', () => {
    renderOpened()
    const [first, , third] = [...DEFAULT_PROVIDERS]

    fireEvent.dragStart(rowAt(2))
    fireEvent.dragOver(rowAt(0))
    fireEvent.drop(rowAt(0))

    expect(readVisibleOrder()[0]).toBe(third)
    expect(readVisibleOrder()[1]).toBe(first)
    expect(readStudioOrder()).toEqual(readVisibleOrder())
  })

  it('leaves the order alone when a provider is dropped back on itself', () => {
    // A click that the browser reports as a tiny drag must not be mistaken for a move,
    // and must not turn the server default into a pinned custom order.
    renderOpened()

    fireEvent.dragStart(rowAt(3))
    fireEvent.dragOver(rowAt(3))
    fireEvent.drop(rowAt(3))

    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])
    expect(readStudioOrder()).toBeNull()
  })

  it('ignores a drop that never began as a drag', () => {
    renderOpened()

    fireEvent.drop(rowAt(1))

    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])
    expect(readStudioOrder()).toBeNull()
  })

  it('forgets a drag abandoned outside the list', () => {
    // Releasing over the page rather than over a row ends the drag. If the source were
    // remembered, the next click that the browser reports as a drop would silently move a
    // provider the visitor is no longer holding.
    renderOpened()

    fireEvent.dragStart(rowAt(2))
    fireEvent.dragEnd(rowAt(2))
    fireEvent.drop(rowAt(0))

    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])
    expect(readStudioOrder()).toBeNull()
  })

  it('moves a selected provider down with the arrow keys', () => {
    // Keyboard parity with the drag handle: pointer-only reordering would leave the
    // priority unreachable without a mouse.
    renderOpened()
    const [first, second] = [...DEFAULT_PROVIDERS]

    fireEvent.keyDown(rowAt(0), { key: 'Enter' })
    fireEvent.keyDown(rowAt(0), { key: 'ArrowDown' })

    expect(readVisibleOrder()[0]).toBe(second)
    expect(readVisibleOrder()[1]).toBe(first)
    expect(readStudioOrder()?.[1]).toBe(first)
  })

  it('keeps the selection on the provider that moved, not on the position', () => {
    // Otherwise a second arrow press picks up whichever provider slid into the old slot
    // and drags the wrong one down the list.
    renderOpened()
    const [first] = [...DEFAULT_PROVIDERS]

    fireEvent.keyDown(rowAt(0), { key: 'Enter' })
    fireEvent.keyDown(rowAt(0), { key: 'ArrowDown' })
    expect(rowAt(1).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(rowAt(1), { key: 'ArrowDown' })
    expect(readVisibleOrder()[2]).toBe(first)
  })

  it('moves a selected provider back up with the arrow keys', () => {
    renderOpened()
    const [, second] = [...DEFAULT_PROVIDERS]

    fireEvent.keyDown(rowAt(1), { key: 'Enter' })
    fireEvent.keyDown(rowAt(1), { key: 'ArrowUp' })

    expect(readVisibleOrder()[0]).toBe(second)
  })

  it('does not reorder while the visitor is only arrowing through the list', () => {
    // Arrow keys move a provider only after it has been picked up with Enter; without
    // that guard, scanning the list rearranges it.
    renderOpened()

    fireEvent.keyDown(rowAt(0), { key: 'ArrowDown' })
    fireEvent.keyDown(rowAt(2), { key: 'ArrowUp' })

    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])
    expect(readStudioOrder()).toBeNull()
  })

  it('will not push a provider off either end of the list', () => {
    renderOpened()

    fireEvent.keyDown(rowAt(0), { key: 'Enter' })
    fireEvent.keyDown(rowAt(0), { key: 'ArrowUp' })
    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])

    const last = DEFAULT_PROVIDERS.length - 1
    fireEvent.keyDown(rowAt(0), { key: 'Enter' })
    fireEvent.keyDown(rowAt(last), { key: 'Enter' })
    fireEvent.keyDown(rowAt(last), { key: 'ArrowDown' })
    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])
    expect(readStudioOrder()).toBeNull()
  })

  it('drops the selection on Enter again and on Escape', () => {
    renderOpened()

    fireEvent.keyDown(rowAt(0), { key: 'Enter' })
    expect(rowAt(0).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(rowAt(0), { key: 'Enter' })
    expect(rowAt(0).getAttribute('aria-selected')).toBe('false')

    fireEvent.click(rowAt(2))
    expect(rowAt(2).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(rowAt(2), { key: 'Escape' })
    expect(rowAt(2).getAttribute('aria-selected')).toBe('false')
  })

  it('deselects a provider clicked a second time', () => {
    renderOpened()

    fireEvent.click(rowAt(1))
    expect(rowAt(1).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(rowAt(1))
    expect(rowAt(1).getAttribute('aria-selected')).toBe('false')
  })

  it('publishes no override once a moved provider is back where it started', () => {
    // The order matches the server again, so the studio must go back to null. Publishing
    // an array that merely equals the default appends a long, pointless parameter to every
    // link the studio generates.
    renderOpened()

    fireEvent.keyDown(rowAt(0), { key: 'Enter' })
    fireEvent.keyDown(rowAt(0), { key: 'ArrowDown' })
    expect(readStudioOrder()).not.toBeNull()

    fireEvent.keyDown(rowAt(1), { key: 'ArrowUp' })
    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])
    expect(readStudioOrder()).toBeNull()
  })

  it('publishes no override once a dragged provider is back where it started', () => {
    // Same rule as the keyboard path, which is easy to implement in one place and forget
    // in the other: a hand-restored default must publish null, not an equal array.
    renderOpened()

    fireEvent.dragStart(rowAt(0))
    fireEvent.dragOver(rowAt(1))
    fireEvent.drop(rowAt(1))
    expect(readStudioOrder()).not.toBeNull()

    fireEvent.dragStart(rowAt(1))
    fireEvent.dragOver(rowAt(0))
    fireEvent.drop(rowAt(0))

    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])
    expect(readStudioOrder()).toBeNull()
  })

  it('leaves the order alone for keys that mean nothing here', () => {
    // Typing, tabbing away or hitting a shortcut while a provider is picked up must not
    // be read as a move.
    renderOpened()

    fireEvent.keyDown(rowAt(0), { key: 'Enter' })
    fireEvent.keyDown(rowAt(0), { key: 'Tab' })
    fireEvent.keyDown(rowAt(0), { key: 'a' })

    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])
    expect(readStudioOrder()).toBeNull()
    expect(rowAt(0).getAttribute('aria-selected')).toBe('true')
  })

  it('restores the server order and clears the override when reset', () => {
    const saved = ['balancer', ...DEFAULT_PROVIDERS.filter((p) => p !== 'balancer')]
    seedPersistedOrder(saved)
    renderOpened()
    expect(readStudioOrder()).toEqual(saved)

    fireEvent.click(resetButton())

    expect(readVisibleOrder()).toEqual([...DEFAULT_PROVIDERS])
    expect(readStudioOrder()).toBeNull()
    expect(screen.queryByText('Custom')).toBeNull()
  })

  it('offers reset only when there is something to reset', () => {
    renderOpened()
    expect((resetButton() as HTMLButtonElement).disabled).toBe(true)

    fireEvent.dragStart(rowAt(1))
    fireEvent.dragOver(rowAt(0))
    fireEvent.drop(rowAt(0))

    expect((resetButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('saves a reordered list so the next visit keeps it', async () => {
    renderOpened()

    fireEvent.dragStart(rowAt(4))
    fireEvent.dragOver(rowAt(0))
    fireEvent.drop(rowAt(0))
    const expected = readVisibleOrder()

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem(STUDIO_STORAGE_KEY) ?? '{}')
      expect(persisted.resolutionOrder).toEqual(expected)
    })
  })
})
