/**
 * The token list editor: the surface where a user assembles, edits, reorders and
 * publishes a token list that lives in browser storage.
 *
 * Almost every failure this component can have is silent. A token dropped during an
 * import still leaves a list that looks fine; an edit that never reaches storage still
 * shows the new value on screen until the page reloads; a duplicate address slips in and
 * only shows up as a doubled row much later; a publish that derives the wrong raw file
 * address submits a working-looking link that points at nothing. So the tests below
 * assert the *persisted* result and the *outgoing request payload* wherever possible,
 * rather than the text that happens to be rendered.
 *
 * What is stubbed, and why:
 *   - `idb-keyval` — the list store writes through it to IndexedDB, which jsdom does not
 *     implement. It is replaced by an in-memory map so the real `useLocalLists` logic and
 *     the real context provider still run, and so the tests can read back exactly what
 *     was written. This mirrors the pattern already used in StudioBrowser.test.tsx and
 *     useLocalLists.test.ts.
 *   - `fetch` — the network boundary.
 *   - `IntersectionObserver`, `ResizeObserver`, `Element.prototype.scrollIntoView` and
 *     `Element.prototype.getBoundingClientRect` — host interfaces jsdom does not supply
 *     or answers with zeroes, reached for by the lazy image and by the Headless UI
 *     publish menu. The measured box has to be non-zero: Headless UI reads an all-zero
 *     box as "the button has left the page" and closes the menu on the spot.
 *   - `getApiUrl` — pinned to a fixed origin so request assertions are exact. Everything
 *     else in that module is re-exported untouched.
 *   - `DndContext` — wrapped, not replaced. The real component still renders (so the
 *     sortable rows behave normally); the wrapper only captures the `onDragEnd` callback,
 *     because drag gestures need real pointer geometry that jsdom cannot produce. The
 *     reorder handler under test is the real one.
 *
 * No application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { createElement } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'

// ---------------------------------------------------------------------------
// Persistence boundary. An in-memory stand-in for IndexedDB.
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => new Map<string, unknown>())
vi.mock('idb-keyval', () => ({
  get: (key: string) => Promise.resolve(store.get(key)),
  set: (key: string, value: unknown) => {
    store.set(key, value)
    return Promise.resolve()
  },
  del: (key: string) => {
    store.delete(key)
    return Promise.resolve()
  },
  keys: () => Promise.resolve([...store.keys()]),
}))

// ---------------------------------------------------------------------------
// Fixed API origin so outgoing request addresses can be asserted literally.
// ---------------------------------------------------------------------------
vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return { ...actual, getApiUrl: (path: string) => `https://api.test${path}` }
})

// ---------------------------------------------------------------------------
// Drag context. The real provider is rendered; we only keep a reference to the
// drag-end callback so the reorder path can be driven without pointer geometry.
// ---------------------------------------------------------------------------
const drag = vi.hoisted(() => ({
  onDragEnd: null as ((event: DragEndEvent) => void) | null,
}))
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    DndContext: (props: Record<string, unknown>) => {
      drag.onDragEnd = props.onDragEnd as (event: DragEndEvent) => void
      return createElement(actual.DndContext, props)
    },
  }
})

import ListEditor from './ListEditor'
import { ListEditorProvider, useListEditor } from '../contexts/ListEditorContext'
import type { LocalList, LocalToken } from '../hooks/useLocalLists'

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const ADDRESS_A = `0x${'a'.repeat(40)}`
const ADDRESS_B = `0x${'b'.repeat(40)}`
const ADDRESS_C = `0x${'c'.repeat(40)}`

/** A response object shaped enough for both application code and the viem transport. */
function jsonResponse(body: unknown, options: { ok?: boolean; status?: number } = {}) {
  const status = options.status ?? 200
  const ok = options.ok ?? (status >= 200 && status < 300)
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
  }
}

const mockFetch = vi.fn()

/**
 * A promise the test resolves by hand, so an in-flight request can be held open long
 * enough to inspect the interface while it is waiting.
 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Every observed element counts as on screen, so lazy images resolve to real img tags. */
class ImmediateIntersectionObserver {
  constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.callback([{ isIntersecting: true }])
  }
  unobserve() {}
  disconnect() {}
}

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * jsdom measures every element as a zero-sized box at the origin. Headless UI treats
 * that exact shape as "the element has disappeared" and closes an open menu, so the
 * publish menu can never be inspected without a plausible measurement.
 */
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
function stubLayoutMeasurement() {
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 120,
      height: 24,
      top: 0,
      left: 0,
      right: 120,
      bottom: 24,
      toJSON() {},
    }) as DOMRect
}

/**
 * Handle onto the editor context so a test can arrange state — create a list, mark it
 * active, point the editor at a remote source key — without first having to click
 * through the flow that produced it.
 */
let editor: ReturnType<typeof useListEditor> | null = null
function ContextProbe() {
  editor = useListEditor()
  return null
}

function renderEditor() {
  return render(
    createElement(ListEditorProvider, null, createElement(ContextProbe), createElement(ListEditor)),
  )
}

/** Read a list straight out of the persistence layer, bypassing React state entirely. */
function persisted(id: string): LocalList {
  return store.get(`gib-list:${id}`) as LocalList
}

function token(overrides: Partial<LocalToken> = {}): LocalToken {
  return {
    chainId: 1,
    address: ADDRESS_A,
    name: 'Alpha',
    symbol: 'ALPH',
    decimals: 18,
    order: 0,
    ...overrides,
  }
}

/** Create a list and open it in the editor, returning the created list. */
async function openList(params: {
  name?: string
  tokens?: LocalToken[]
  source?: LocalList['source']
}): Promise<LocalList> {
  let created: LocalList | null = null
  await act(async () => {
    created = await editor!.createList({
      name: params.name ?? 'My List',
      source: params.source ?? { type: 'scratch' },
      tokens: params.tokens ?? [],
    })
    editor!.setActiveList(created)
  })
  return created!
}

beforeEach(() => {
  store.clear()
  localStorage.clear()
  sessionStorage.clear()
  drag.onDragEnd = null
  editor = null
  mockFetch.mockReset()
  mockFetch.mockResolvedValue(jsonResponse({}))
  vi.stubGlobal('fetch', mockFetch)
  vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver)
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  Element.prototype.scrollIntoView = vi.fn()
  stubLayoutMeasurement()
})

afterEach(() => {
  cleanup()
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  store.clear()
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Creation menu — the state with no active list
// ---------------------------------------------------------------------------

describe('ListEditor creation menu', () => {
  it('offers a starting point rather than an empty pane when nothing is open', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    expect(screen.getByText('New List')).toBeTruthy()
    expect(screen.getByText('Import from URL')).toBeTruthy()
    expect(screen.getByText('Paste JSON')).toBeTruthy()
  })

  it('creates and opens a scratch list, recording its source type', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByText('New List'))
    })

    // The editor has switched to the active-list view for the list it just made.
    await waitFor(() => expect(screen.getByText('0 tokens')).toBeTruthy())
    const [saved] = [...store.values()] as LocalList[]
    expect(saved.source.type).toBe('scratch')
    expect(saved.tokens).toEqual([])
  })

  it('hides the fork option until the editor is pointed at a remote list', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    expect(screen.queryByText(/^Fork /)).toBeNull()

    await act(async () => {
      editor!.openEditor('gib/default')
    })
    expect(screen.getByText('Fork gib/default')).toBeTruthy()
  })

  it('forks a remote list carrying every token across, not just the ones it can name', async () => {
    // The silent failure guarded here is a token quietly dropped in translation: a
    // remote entry with no name or no logo must still become a local token.
    mockFetch.mockResolvedValue(
      jsonResponse({
        name: 'Remote List',
        description: 'from upstream',
        tokens: [
          { chainId: 1, address: ADDRESS_A, name: 'Alpha', symbol: 'ALPH', decimals: 18, logoURI: 'https://img/a.png' },
          { address: ADDRESS_B },
        ],
      }),
    )
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await act(async () => {
      editor!.openEditor('gib/default')
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Fork gib/default'))
    })

    await waitFor(() => expect(screen.getByText('2 tokens')).toBeTruthy())
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.test/list/gib/default')

    const [saved] = [...store.values()] as LocalList[]
    expect(saved.name).toBe('Remote List')
    expect(saved.description).toBe('from upstream')
    expect(saved.source).toEqual({ type: 'fork', remoteProvider: 'gib', remoteKey: 'default' })
    expect(saved.tokens.map((t) => t.address)).toEqual([ADDRESS_A, ADDRESS_B])
    // The remote logo address becomes the local image address.
    expect(saved.tokens[0].imageUri).toBe('https://img/a.png')
    // A token with no logo keeps no image address rather than an empty string.
    expect(saved.tokens[1].imageUri).toBeUndefined()
    // Missing fields fall back to defaults instead of the string "undefined".
    expect(saved.tokens[1].name).toBe('')
    expect(saved.tokens[1].decimals).toBe(18)
    // A remote entry with no chain named falls back to chain one rather than NaN.
    expect(saved.tokens[1].chainId).toBe(1)
    // Position is preserved as an explicit order, not left to array luck.
    expect(saved.tokens.map((t) => t.order)).toEqual([0, 1])
  })

  it('forks an upstream list that names nothing, falling back to the source key', async () => {
    // A remote list served with no name, description or token array must still produce a
    // usable local list rather than one called "undefined" that crashes on open.
    mockFetch.mockResolvedValue(jsonResponse({}))
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await act(async () => {
      editor!.openEditor('gib/default')
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Fork gib/default'))
    })

    await waitFor(() => expect(screen.getByText('0 tokens')).toBeTruthy())
    const [saved] = [...store.values()] as LocalList[]
    expect(saved.name).toBe('gib/default')
    expect(saved.description).toBe('')
    expect(saved.tokens).toEqual([])
  })

  it('reports a failed fork instead of creating a half-empty list', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, { status: 502 }))
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await act(async () => {
      editor!.openEditor('gib/default')
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Fork gib/default'))
    })

    await waitFor(() => expect(screen.getByText(/Failed to fetch list: 502/)).toBeTruthy())
    expect(store.size).toBe(0)
  })

  it('keeps the import button inert until an address is typed', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const button = screen.getByText('Import') as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('https://tokens.uniswap.org'), {
      target: { value: 'https://example.test/list.json' },
    })
    expect((screen.getByText('Import') as HTMLButtonElement).disabled).toBe(false)
  })

  it('imports from a web address, fetching exactly that one and recording it on the list', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ tokens: [{ chainId: 1, address: ADDRESS_A, name: 'Alpha', symbol: 'ALPH', decimals: 6 }] }),
    )
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const input = screen.getByPlaceholderText('https://tokens.uniswap.org')
    fireEvent.change(input, { target: { value: '  https://example.test/list.json  ' } })

    await act(async () => {
      fireEvent.click(screen.getByText('Import'))
    })

    await waitFor(() => expect(screen.getByText('1 token')).toBeTruthy())
    // Surrounding whitespace must not reach the network or the stored source.
    expect(mockFetch.mock.calls[0][0]).toBe('https://example.test/list.json')
    const [saved] = [...store.values()] as LocalList[]
    expect(saved.source).toEqual({ type: 'import', remoteUrl: 'https://example.test/list.json' })
    // No name in the payload falls back to a placeholder rather than "undefined".
    expect(saved.name).toBe('Imported List')
    expect(saved.tokens[0].decimals).toBe(6)
  })

  it('locks the import controls while a request is in flight', async () => {
    // Without this, an impatient second click starts a second import and produces two
    // copies of the same list.
    const pending = deferred<ReturnType<typeof jsonResponse>>()
    mockFetch.mockReturnValue(pending.promise)
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await act(async () => {
      editor!.openEditor('gib/default')
    })
    fireEvent.change(screen.getByPlaceholderText('https://tokens.uniswap.org'), {
      target: { value: 'https://example.test/list.json' },
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Import'))
    })

    // The label changes and both import routes are barred until it settles.
    expect(screen.queryByText('Import')).toBeNull()
    expect((screen.getByText('...') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Fork gib/default').closest('button') as HTMLButtonElement).disabled).toBe(
      true,
    )

    await act(async () => {
      pending.resolve(jsonResponse({ tokens: [] }))
      await pending.promise
    })
    await waitFor(() => expect(screen.getByText('0 tokens')).toBeTruthy())
  })

  it('rejects a payload with no token array rather than importing an empty list', async () => {
    // Accepting this silently is the expensive case: the user gets a list that looks
    // created and is permanently empty.
    mockFetch.mockResolvedValue(jsonResponse({ name: 'Not A List' }))
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('https://tokens.uniswap.org'), {
      target: { value: 'https://example.test/list.json' },
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Import'))
    })

    await waitFor(() => expect(screen.getByText('Invalid token list format')).toBeTruthy())
    expect(store.size).toBe(0)
  })

  it('surfaces a non-success import response as an error', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, { status: 404 }))
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('https://tokens.uniswap.org'), {
      target: { value: 'https://example.test/list.json' },
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Import'))
    })

    await waitFor(() => expect(screen.getByText(/Failed to fetch: 404/)).toBeTruthy())
    expect(store.size).toBe(0)
  })

  it('parses pasted list JSON into a list', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('{"tokens": [...]}'), {
      target: {
        value: JSON.stringify({
          name: 'Pasted',
          tokens: [
            { chainId: 369, address: ADDRESS_A, name: 'Alpha', symbol: 'ALPH', decimals: 18 },
            { chainId: 369, address: ADDRESS_B, name: 'Beta', symbol: 'BETA', decimals: 8 },
          ],
        }),
      },
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Parse & Import'))
    })

    await waitFor(() => expect(screen.getByText('2 tokens')).toBeTruthy())
    const [saved] = [...store.values()] as LocalList[]
    expect(saved.source.type).toBe('paste')
    expect(saved.name).toBe('Pasted')
    expect(saved.tokens.map((t) => t.chainId)).toEqual([369, 369])
  })

  it('accepts a single pasted token object as a one-token list', async () => {
    // The `data.tokens || [data]` fallback: pasting one token from a block explorer is a
    // real habit, and treating it as "no tokens" would look like the paste did nothing.
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('{"tokens": [...]}'), {
      target: { value: JSON.stringify({ chainId: 1, address: ADDRESS_C, symbol: 'GAM', decimals: 9 }) },
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Parse & Import'))
    })

    await waitFor(() => expect(screen.getByText('1 token')).toBeTruthy())
    const [saved] = [...store.values()] as LocalList[]
    expect(saved.tokens).toHaveLength(1)
    expect(saved.tokens[0].address).toBe(ADDRESS_C)
    expect(saved.name).toBe('Pasted List')
  })

  it('reports malformed pasted JSON instead of creating a list from nothing', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('{"tokens": [...]}'), {
      target: { value: '{ not json' },
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Parse & Import'))
    })

    await waitFor(() => expect(screen.getByText('Import from URL')).toBeTruthy())
    expect(store.size).toBe(0)
    // The parse failure is shown rather than swallowed.
    expect(screen.getByText('Parse & Import')).toBeTruthy()
    expect(document.body.textContent).toMatch(/JSON/i)
  })

  it('leaves the paste button inert with an empty box', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    expect((screen.getByText('Parse & Import') as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides the saved-list section entirely when nothing is saved', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    expect(screen.queryByText('My Lists')).toBeNull()
  })

  it('lists saved lists with their token counts and opens the one clicked', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await act(async () => {
      await editor!.createList({ name: 'Saved One', source: { type: 'scratch' }, tokens: [token()] })
    })

    await waitFor(() => expect(screen.getByText('My Lists')).toBeTruthy())
    expect(screen.getByText('1 saved')).toBeTruthy()
    // The count badge is the only signal of how full a saved list is.
    expect(screen.getByText('1')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('Saved One'))
    })
    await waitFor(() => expect(screen.getByText('1 token')).toBeTruthy())
  })

  it('deletes a saved list without opening it', async () => {
    // The delete control sits inside the row that opens the list, so a missing
    // stopPropagation would delete the list and then open the deleted list.
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await act(async () => {
      await editor!.createList({ name: 'Doomed', source: { type: 'scratch' }, tokens: [] })
    })
    await waitFor(() => expect(screen.getByText('Doomed')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByTitle('Delete list'))
    })

    await waitFor(() => expect(screen.queryByText('Doomed')).toBeNull())
    expect(store.size).toBe(0)
    // Still on the creation menu, not inside a list that no longer exists.
    expect(screen.getByText('New List')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Active list — token membership
// ---------------------------------------------------------------------------

describe('ListEditor token membership', () => {
  it('shows an inviting empty state, not a blank pane, for a list with no tokens', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [] })

    expect(screen.getByText('No tokens yet. Add an address above.')).toBeTruthy()
    expect(screen.getByText('0 tokens')).toBeTruthy()
  })

  it('renders one row per token and pluralises the count', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token(), token({ address: ADDRESS_B, name: 'Beta', order: 1 })] })

    expect(screen.queryByText('No tokens yet. Add an address above.')).toBeNull()
    expect(screen.getByText('2 tokens')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('adds a typed address to the list and to storage, then clears the box', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ tokens: [] })

    const input = screen.getByPlaceholderText('0x... token address') as HTMLInputElement
    fireEvent.change(input, { target: { value: `  ${ADDRESS_A.toUpperCase()}  ` } })
    await act(async () => {
      fireEvent.click(screen.getByText('Add'))
    })

    await waitFor(() => expect(screen.getByText('1 token')).toBeTruthy())
    // Addresses are normalised so a later duplicate check can actually match.
    expect(persisted(list.id).tokens[0].address).toBe(ADDRESS_A)
    expect(input.value).toBe('')
  })

  it('adds on the Enter key so the mouse is not required', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ tokens: [] })

    const input = screen.getByPlaceholderText('0x... token address')
    fireEvent.change(input, { target: { value: ADDRESS_B } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    await waitFor(() => expect(persisted(list.id).tokens).toHaveLength(1))
    expect(persisted(list.id).tokens[0].address).toBe(ADDRESS_B)
  })

  it('ignores a non-Enter key so typing does not add half an address', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ tokens: [] })

    const input = screen.getByPlaceholderText('0x... token address')
    fireEvent.change(input, { target: { value: ADDRESS_B } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'a' })
    })

    expect(persisted(list.id).tokens).toHaveLength(0)
  })

  it('refuses a duplicate address regardless of letter case', async () => {
    // A duplicate is the archetypal quiet defect: the list still works, it just carries
    // the same token twice and publishes a list that fails downstream validation.
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ tokens: [token()] })

    fireEvent.change(screen.getByPlaceholderText('0x... token address'), {
      target: { value: ADDRESS_A.toUpperCase() },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Add'))
    })

    await waitFor(() => expect(screen.getByText('Token already in list')).toBeTruthy())
    expect(persisted(list.id).tokens).toHaveLength(1)
  })

  it('clears the duplicate warning once a different address is added', async () => {
    // Regression guard: the banner used to be set and never cleared, so a rejected
    // duplicate left a permanent "Token already in list" warning above a list that was
    // accepting tokens perfectly well.
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token()] })

    fireEvent.change(screen.getByPlaceholderText('0x... token address'), {
      target: { value: ADDRESS_A },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Add'))
    })
    await waitFor(() => expect(screen.getByText('Token already in list')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText('0x... token address'), {
      target: { value: ADDRESS_B },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Add'))
    })
    await waitFor(() => expect(screen.getByText('2 tokens')).toBeTruthy())
    expect(screen.queryByText('Token already in list')).toBeNull()
  })

  it('inherits the chain of the tokens already present rather than assuming chain one', async () => {
    // Adding a PulseChain list entry that silently lands on Ethereum produces an image
    // and metadata lookup against the wrong chain — wrong, but plausible-looking.
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ tokens: [token({ chainId: 369 })] })

    fireEvent.change(screen.getByPlaceholderText('0x... token address'), {
      target: { value: ADDRESS_B },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Add'))
    })

    await waitFor(() => expect(persisted(list.id).tokens).toHaveLength(2))
    expect(persisted(list.id).tokens[1].chainId).toBe(369)
  })

  it('defaults to chain one when the list is still empty', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ tokens: [] })

    fireEvent.change(screen.getByPlaceholderText('0x... token address'), {
      target: { value: ADDRESS_B },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Add'))
    })

    await waitFor(() => expect(persisted(list.id).tokens).toHaveLength(1))
    expect(persisted(list.id).tokens[0].chainId).toBe(1)
  })

  it('keeps the add button inert for an empty or whitespace-only address', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [] })

    expect((screen.getByText('Add') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('0x... token address'), { target: { value: '   ' } })
    expect((screen.getByText('Add') as HTMLButtonElement).disabled).toBe(true)
  })

  it('removes a token from both the view and storage, leaving the others alone', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({
      tokens: [token(), token({ address: ADDRESS_B, name: 'Beta', order: 1 })],
    })

    await act(async () => {
      fireEvent.click(screen.getAllByTitle('Remove token')[0])
    })

    await waitFor(() => expect(screen.getByText('1 token')).toBeTruthy())
    expect(persisted(list.id).tokens.map((t) => t.address)).toEqual([ADDRESS_B])
  })
})

// ---------------------------------------------------------------------------
// Active list — editing, ordering and provenance
// ---------------------------------------------------------------------------

describe('ListEditor list editing', () => {
  it('persists a renamed list rather than only showing the new name', async () => {
    // An edit that renders but never lands is invisible until the next page load.
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ name: 'Old Name', tokens: [] })

    const nameInput = screen.getByDisplayValue('Old Name')
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'New Name' } })
    })

    await waitFor(() => expect(persisted(list.id).name).toBe('New Name'))
    expect((screen.getByDisplayValue('New Name') as HTMLInputElement).value).toBe('New Name')
  })

  it('shows where a forked list came from', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({
      tokens: [],
      source: { type: 'fork', remoteProvider: 'gib', remoteKey: 'default' },
    })

    expect(screen.getByText(/forked from/).textContent).toContain('gib/default')
  })

  it('omits the provenance line for a list with no upstream', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [], source: { type: 'scratch' } })

    expect(screen.queryByText(/forked from/)).toBeNull()
  })

  it('reorders tokens by drag and writes the new order through', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({
      tokens: [
        token(),
        token({ address: ADDRESS_B, name: 'Beta', order: 1 }),
        token({ address: ADDRESS_C, name: 'Gamma', order: 2 }),
      ],
    })
    await waitFor(() => expect(drag.onDragEnd).toBeTruthy())

    await act(async () => {
      await drag.onDragEnd!({
        active: { id: `1-${ADDRESS_A}` },
        over: { id: `1-${ADDRESS_C}` },
      } as DragEndEvent)
    })

    await waitFor(() =>
      expect(persisted(list.id).tokens.map((t) => t.address)).toEqual([
        ADDRESS_B,
        ADDRESS_C,
        ADDRESS_A,
      ]),
    )
    // The order field is renumbered, not left stale — it is what the published list
    // sorts by, so a stale value silently restores the old sequence.
    expect(persisted(list.id).tokens.map((t) => t.order)).toEqual([0, 1, 2])
  })

  it('leaves the order untouched when a drag is dropped outside any row', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({
      tokens: [token(), token({ address: ADDRESS_B, name: 'Beta', order: 1 })],
    })
    await waitFor(() => expect(drag.onDragEnd).toBeTruthy())

    await act(async () => {
      await drag.onDragEnd!({ active: { id: `1-${ADDRESS_A}` }, over: null } as DragEndEvent)
    })

    expect(persisted(list.id).tokens.map((t) => t.address)).toEqual([ADDRESS_A, ADDRESS_B])
  })

  it('leaves the order untouched when a token is dropped back on itself', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({
      tokens: [token(), token({ address: ADDRESS_B, name: 'Beta', order: 1 })],
    })
    await waitFor(() => expect(drag.onDragEnd).toBeTruthy())

    await act(async () => {
      await drag.onDragEnd!({
        active: { id: `1-${ADDRESS_A}` },
        over: { id: `1-${ADDRESS_A}` },
      } as DragEndEvent)
    })

    expect(persisted(list.id).tokens.map((t) => t.address)).toEqual([ADDRESS_A, ADDRESS_B])
  })

  it('ignores a drag referring to a token that is no longer in the list', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({
      tokens: [token(), token({ address: ADDRESS_B, name: 'Beta', order: 1 })],
    })
    await waitFor(() => expect(drag.onDragEnd).toBeTruthy())

    await act(async () => {
      await drag.onDragEnd!({
        active: { id: `1-${ADDRESS_C}` },
        over: { id: `1-${ADDRESS_B}` },
      } as DragEndEvent)
    })

    // A dropped token, rather than a shuffled one, is the failure to avoid here.
    expect(persisted(list.id).tokens.map((t) => t.address)).toEqual([ADDRESS_A, ADDRESS_B])
  })
})

// ---------------------------------------------------------------------------
// Active list — images
// ---------------------------------------------------------------------------

describe('ListEditor token images', () => {
  it('opens the image manager for the token whose icon was clicked', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({
      tokens: [
        token({ imageUri: 'https://img/a.png' }),
        token({ address: ADDRESS_B, name: 'Beta', order: 1, imageUri: 'https://img/b.png' }),
      ],
    })

    await act(async () => {
      fireEvent.click(screen.getAllByTitle('Edit image')[1])
    })

    expect(screen.getByText('Token Image')).toBeTruthy()
    // The manager must be pointed at the clicked token's own image, not the first one.
    const previews = screen.getAllByRole('img') as HTMLImageElement[]
    expect(previews.some((image) => image.getAttribute('src')?.includes('https://img/b.png'))).toBe(true)
  })

  it('closes the image manager, leaving the token exactly as it was', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ tokens: [token({ imageUri: 'https://img/a.png' })] })

    await act(async () => {
      fireEvent.click(screen.getByTitle('Edit image'))
    })
    expect(screen.getByText('Token Image')).toBeTruthy()

    await act(async () => {
      fireEvent.click(document.querySelector('.fa-times.text-xs')!.closest('button')!)
    })

    expect(screen.queryByText('Token Image')).toBeNull()
    // Dismissing is not an edit.
    expect(persisted(list.id).tokens[0].imageUri).toBe('https://img/a.png')
  })

  it('resets a token image back to the address the service serves by default', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ tokens: [token({ imageUri: 'https://img/a.png' })] })

    await act(async () => {
      fireEvent.click(screen.getByTitle('Edit image'))
    })
    expect(screen.getByText('Token Image')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('Reset to default'))
    })
    await waitFor(() =>
      expect(persisted(list.id).tokens[0].imageUri).toBe(`https://api.test/image/eip155-1/${ADDRESS_A}`),
    )
  })

  it('persists an image address chosen in the manager against the right token', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({
      tokens: [
        token({ imageUri: 'https://img/a.png' }),
        token({ address: ADDRESS_B, name: 'Beta', order: 1, imageUri: 'https://img/b.png' }),
      ],
    })

    await act(async () => {
      fireEvent.click(screen.getAllByTitle('Edit image')[1])
    })
    fireEvent.change(screen.getByPlaceholderText('Image URL...'), {
      target: { value: 'https://img/new-beta.svg' },
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Set'))
    })

    await waitFor(() => expect(persisted(list.id).tokens[1].imageUri).toBe('https://img/new-beta.svg'))
    // The token that was not being edited keeps its own image.
    expect(persisted(list.id).tokens[0].imageUri).toBe('https://img/a.png')
  })

  it('uploads an inline image and stores the address the server hands back', async () => {
    // The row shows an upload widget only when the token has no image, so this is the
    // path a freshly added address takes.
    mockFetch.mockResolvedValue(
      jsonResponse({ imageHash: 'abc', imageUrl: 'https://api.test/image/hash/abc' }),
    )
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({
      tokens: [token({ chainId: 369 }), token({ chainId: 369, address: ADDRESS_B, name: 'Beta', order: 1 })],
    })

    const fileInput = document.querySelectorAll('input[type="file"]')[0] as HTMLInputElement
    await act(async () => {
      fireEvent.change(fileInput, {
        target: { files: [new File(['<svg />'], 'icon.svg', { type: 'image/svg+xml' })] },
      })
    })

    await waitFor(() =>
      expect(persisted(list.id).tokens[0].imageUri).toBe('https://api.test/image/hash/abc'),
    )
    // Only the uploaded token gains an image; the rest of the list is untouched.
    expect(persisted(list.id).tokens[1].imageUri).toBeUndefined()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.test/api/images/submit')
    const body = JSON.parse((init as RequestInit).body as string)
    // The upload must carry the token's own chain and address, or the stored image is
    // filed against the wrong token and never shows up.
    expect(body.chainId).toBe(369)
    expect(body.address).toBe(ADDRESS_A)
    expect(body.image).toContain('data:image/svg+xml')
  })

  it('reports a failed image upload instead of leaving the row unchanged and silent', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Image too large' }, { status: 413 }))
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ tokens: [token()] })

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(fileInput, {
        target: { files: [new File(['<svg />'], 'icon.svg', { type: 'image/svg+xml' })] },
      })
    })

    await waitFor(() => expect(screen.getByText('Image too large')).toBeTruthy())
    expect(persisted(list.id).tokens[0].imageUri).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Active list — chain metadata
// ---------------------------------------------------------------------------

/** Encode a Solidity string return value the way an eth_call response carries it. */
function encodeStringResult(value: string): string {
  const hex = Buffer.from(value, 'utf8').toString('hex')
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64 || 64, '0')
  const offset = (32).toString(16).padStart(64, '0')
  const length = (hex.length / 2).toString(16).padStart(64, '0')
  return `0x${offset}${length}${padded}`
}

const SELECTORS = {
  name: '06fdde03',
  symbol: '95d89b41',
  decimals: '313ce567',
}

describe('ListEditor chain metadata', () => {
  it('keeps the metadata button inert while the list is empty', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [] })

    expect((screen.getByText('Load RPC') as HTMLButtonElement).disabled).toBe(true)
  })

  it('fills in name, symbol and decimals read from the chain', async () => {
    // Silent failure guarded: metadata that is fetched and then dropped on the floor
    // leaves every row reading "Unknown / ???" with no error anywhere.
    localStorage.setItem('gib-custom-rpcs', JSON.stringify({ 1: 'https://rpc.test' }))
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(init.body as string)
      const data: string = request.params[0].data
      if (data.startsWith(`0x${SELECTORS.name}`))
        return jsonResponse({ jsonrpc: '2.0', id: request.id, result: encodeStringResult('Wrapped Ether') })
      if (data.startsWith(`0x${SELECTORS.symbol}`))
        return jsonResponse({ jsonrpc: '2.0', id: request.id, result: encodeStringResult('WETH') })
      return jsonResponse({
        jsonrpc: '2.0',
        id: request.id,
        result: `0x${(6).toString(16).padStart(64, '0')}`,
      })
    })

    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({
      tokens: [token({ name: '', symbol: '', decimals: 18 })],
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Load RPC'))
    })

    await waitFor(() => expect(persisted(list.id).tokens[0].symbol).toBe('WETH'))
    expect(persisted(list.id).tokens[0].name).toBe('Wrapped Ether')
    // Zero is a legal decimals value, so the merge uses nullish coalescing; an `||`
    // here would silently rewrite it to the old value.
    expect(persisted(list.id).tokens[0].decimals).toBe(6)
    expect(mockFetch.mock.calls[0][0]).toMatch(/^https:\/\/rpc\.test\/?$/)
  })

  it('keeps the values already entered when the chain has nothing to offer', async () => {
    // No configured endpoint for the chain: every result comes back empty. The existing
    // hand-entered name and symbol must survive rather than being blanked.
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({
      tokens: [token({ chainId: 987654321, name: 'Hand Typed', symbol: 'HAND', decimals: 12 })],
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Load RPC'))
    })

    await waitFor(() => expect(persisted(list.id).tokens[0].order).toBe(0))
    expect(persisted(list.id).tokens[0].name).toBe('Hand Typed')
    expect(persisted(list.id).tokens[0].symbol).toBe('HAND')
    expect(persisted(list.id).tokens[0].decimals).toBe(12)
    // Nothing left the browser, because there is no endpoint to ask.
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Active list — publishing and submission
// ---------------------------------------------------------------------------

describe('ListEditor publishing', () => {
  it('will not publish an empty list', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [] })

    expect((screen.getByText('Publish').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables publishing once the list has a token', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token()] })

    expect((screen.getByText('Publish').closest('button') as HTMLButtonElement).disabled).toBe(false)
  })

  it('says how to configure a destination when none is set up', async () => {
    // Falling back to an empty menu would read as a broken button.
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token()] })

    await act(async () => {
      // Headless UI opens its menu from the keyboard as well as the pointer; the
      // keyboard route needs no pointer geometry, which jsdom cannot provide.
      fireEvent.keyDown(screen.getByText('Publish').closest('button')!, { key: 'Enter' })
    })

    await waitFor(() => expect(screen.getByText(/No providers configured/)).toBeTruthy())
  })

  it('marks a destination as needing a connection until a token is stored for it', async () => {
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'client-id')
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token()] })

    await act(async () => {
      // Headless UI opens its menu from the keyboard as well as the pointer; the
      // keyboard route needs no pointer geometry, which jsdom cannot provide.
      fireEvent.keyDown(screen.getByText('Publish').closest('button')!, { key: 'Enter' })
    })

    await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
    expect(screen.getByText('Connect')).toBeTruthy()
    expect(screen.queryByText('Connected')).toBeNull()
  })

  it('marks a destination as connected once a token is stored for it', async () => {
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'client-id')
    localStorage.setItem(
      'gib-vcs-tokens',
      JSON.stringify({ github: { token: 'stored-token', storedAt: Date.now() } }),
    )
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token()] })

    await act(async () => {
      // Headless UI opens its menu from the keyboard as well as the pointer; the
      // keyboard route needs no pointer geometry, which jsdom cannot provide.
      fireEvent.keyDown(screen.getByText('Publish').closest('button')!, { key: 'Enter' })
    })

    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy())
    expect(screen.queryByText('Connect')).toBeNull()
  })

  it('shows the published locations and submits the raw file address for indexing', async () => {
    // The expensive silent failure: a submitted address that is well-formed but points
    // at the wrong path, so indexing quietly finds nothing.
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'client-id')
    localStorage.setItem(
      'gib-vcs-tokens',
      JSON.stringify({ github: { token: 'stored-token', storedAt: Date.now() } }),
    )
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.github.com/user') return jsonResponse({ login: 'alice' })
      if (url.startsWith('https://api.github.com/repos/alice/') && url.includes('/contents/'))
        return init?.method === 'PUT'
          ? jsonResponse({
              commit: { html_url: 'https://github.com/alice/token-list-my-list/commit/1' },
              content: { html_url: 'https://github.com/alice/token-list-my-list/blob/main/tokenlist.json' },
            })
          : jsonResponse({}, { status: 404 })
      if (url.startsWith('https://api.github.com/repos/alice/'))
        return jsonResponse({ html_url: 'https://github.com/alice/token-list-my-list' })
      if (url === 'https://api.test/api/lists/submit')
        return jsonResponse({ status: 'pending', providerKey: 'alice', listKey: 'token-list-my-list' })
      return jsonResponse({})
    })

    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token()] })

    await act(async () => {
      // Headless UI opens its menu from the keyboard as well as the pointer; the
      // keyboard route needs no pointer geometry, which jsdom cannot provide.
      fireEvent.keyDown(screen.getByText('Publish').closest('button')!, { key: 'Enter' })
    })
    await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByText('GitHub').closest('button')!)
    })

    await waitFor(() => expect(screen.getByText('Published!')).toBeTruthy())
    expect(screen.getByText('View repo').getAttribute('href')).toBe(
      'https://github.com/alice/token-list-my-list',
    )
    expect(screen.getByText('View file').getAttribute('href')).toBe(
      'https://github.com/alice/token-list-my-list/blob/main/tokenlist.json',
    )

    await act(async () => {
      fireEvent.click(screen.getByText('Submit to Gib.Show'))
    })

    await waitFor(() => expect(screen.getByText(/Submitted!/)).toBeTruthy())
    const submitCall = mockFetch.mock.calls.find(
      (call) => call[0] === 'https://api.test/api/lists/submit',
    )!
    const body = JSON.parse(submitCall[1].body)
    expect(body.url).toBe(
      'https://raw.githubusercontent.com/alice/token-list-my-list/main/tokenlist.json',
    )
    expect(body.name).toBe('My List')
    expect(body.submittedBy).toBe('alice')
    expect(screen.getByText(/Submitted!/).textContent).toContain('alice/token-list-my-list')
  })

  it('announces a publish in progress and refuses a second one', async () => {
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'client-id')
    localStorage.setItem(
      'gib-vcs-tokens',
      JSON.stringify({ github: { token: 'stored-token', storedAt: Date.now() } }),
    )
    const pending = deferred<ReturnType<typeof jsonResponse>>()
    mockFetch.mockReturnValue(pending.promise)

    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token()] })

    await act(async () => {
      fireEvent.keyDown(screen.getByText('Publish').closest('button')!, { key: 'Enter' })
    })
    await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByText('GitHub').closest('button')!)
    })

    // A second publish while the first is running would race two commits.
    const button = screen.getByText('Publishing...').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)

    await act(async () => {
      pending.resolve(jsonResponse({}, { status: 401 }))
      await pending.promise
    })
    await waitFor(() => expect(screen.getByText('Publish')).toBeTruthy())
  })

  it('reports a submission that never reached the service', async () => {
    // A network failure here must not read as a quiet success.
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'client-id')
    localStorage.setItem(
      'gib-vcs-tokens',
      JSON.stringify({ github: { token: 'stored-token', storedAt: Date.now() } }),
    )
    const submitPending = deferred<ReturnType<typeof jsonResponse>>()
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.github.com/user') return jsonResponse({ login: 'alice' })
      if (url.startsWith('https://api.github.com/repos/alice/') && url.includes('/contents/'))
        return init?.method === 'PUT' ? jsonResponse({ content: {} }) : jsonResponse({}, { status: 404 })
      if (url.startsWith('https://api.github.com/repos/alice/'))
        return jsonResponse({ html_url: 'https://github.com/alice/token-list-my-list' })
      if (url === 'https://api.test/api/lists/submit') return submitPending.promise
      return jsonResponse({})
    })

    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token()] })

    await act(async () => {
      fireEvent.keyDown(screen.getByText('Publish').closest('button')!, { key: 'Enter' })
    })
    await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByText('GitHub').closest('button')!)
    })
    await waitFor(() => expect(screen.getByText('Published!')).toBeTruthy())
    // The published banner offers no file link when the service returned no file
    // address, rather than a link to nowhere.
    expect(screen.queryByText('View file')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByText('Submit to Gib.Show'))
    })
    expect((screen.getByText('Submitting...') as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      submitPending.resolve(
        Promise.reject(new Error('Network unreachable')) as unknown as ReturnType<typeof jsonResponse>,
      )
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByText('Network unreachable')).toBeTruthy())
  })

  it.each([
    { hasErrorBody: true, expected: 'List already submitted' },
    // A refusal with no explanation still has to say something; a blank line reads as
    // nothing having happened at all.
    { hasErrorBody: false, expected: 'Server error 409' },
  ])('reports a rejected submission rather than claiming success', async ({ hasErrorBody, expected }) => {
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'client-id')
    localStorage.setItem(
      'gib-vcs-tokens',
      JSON.stringify({ github: { token: 'stored-token', storedAt: Date.now() } }),
    )
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.github.com/user') return jsonResponse({ login: 'alice' })
      if (url.startsWith('https://api.github.com/repos/alice/') && url.includes('/contents/'))
        return init?.method === 'PUT'
          ? jsonResponse({ content: {} })
          : jsonResponse({}, { status: 404 })
      if (url.startsWith('https://api.github.com/repos/alice/'))
        return jsonResponse({ html_url: 'https://github.com/alice/token-list-my-list' })
      if (url === 'https://api.test/api/lists/submit')
        return jsonResponse(hasErrorBody ? { error: 'List already submitted' } : {}, { status: 409 })
      return jsonResponse({})
    })

    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token()] })

    await act(async () => {
      // Headless UI opens its menu from the keyboard as well as the pointer; the
      // keyboard route needs no pointer geometry, which jsdom cannot provide.
      fireEvent.keyDown(screen.getByText('Publish').closest('button')!, { key: 'Enter' })
    })
    await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByText('GitHub').closest('button')!)
    })
    await waitFor(() => expect(screen.getByText('Published!')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByText('Submit to Gib.Show'))
    })

    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy())
    expect(screen.queryByText(/Submitted!/)).toBeNull()
  })

  it('surfaces a publish failure as an error banner and offers no submit control', async () => {
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'client-id')
    localStorage.setItem(
      'gib-vcs-tokens',
      JSON.stringify({ github: { token: 'expired-token', storedAt: Date.now() } }),
    )
    mockFetch.mockImplementation(async (url: string) => {
      if (url === 'https://api.github.com/user') return jsonResponse({}, { status: 401 })
      return jsonResponse({})
    })

    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    await openList({ tokens: [token()] })

    await act(async () => {
      // Headless UI opens its menu from the keyboard as well as the pointer; the
      // keyboard route needs no pointer geometry, which jsdom cannot provide.
      fireEvent.keyDown(screen.getByText('Publish').closest('button')!, { key: 'Enter' })
    })
    await waitFor(() => expect(screen.getByText('GitHub')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByText('GitHub').closest('button')!)
    })

    await waitFor(() => expect(screen.getByText(/GitHub auth failed/)).toBeTruthy())
    expect(screen.queryByText('Published!')).toBeNull()
    expect(screen.queryByText('Submit to Gib.Show')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

describe('ListEditor closing', () => {
  it('closes from the creation menu', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    expect(editor!.isOpen).toBe(false)
    await act(async () => {
      editor!.openNewEditor()
    })
    expect(editor!.isOpen).toBe(true)

    await act(async () => {
      fireEvent.click(document.querySelector('.fa-times')!.closest('button')!)
    })
    expect(editor!.isOpen).toBe(false)
  })

  it('closes from an open list without discarding it', async () => {
    renderEditor()
    await waitFor(() => expect(editor).toBeTruthy())
    const list = await openList({ tokens: [token()] })
    expect(editor!.activeList).toBeTruthy()

    await act(async () => {
      fireEvent.click(document.querySelector('.fa-times')!.closest('button')!)
    })

    expect(editor!.activeList).toBeNull()
    // Closing is not deleting: the list is still saved.
    expect(persisted(list.id)).toBeTruthy()
  })
})
