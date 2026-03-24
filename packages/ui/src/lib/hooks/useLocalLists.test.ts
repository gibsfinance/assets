import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory store backing the idb-keyval mock
const store = new Map<string, unknown>()

// vi.hoisted ensures these are available when vi.mock factory runs (which is hoisted to top)
const { mockGet, mockSet, mockDel, mockKeys } = vi.hoisted(() => ({
  mockGet: vi.fn((key: string) => Promise.resolve(store.get(key))),
  mockSet: vi.fn((key: string, val: unknown) => {
    store.set(key, val)
    return Promise.resolve()
  }),
  mockDel: vi.fn((key: string) => {
    store.delete(key)
    return Promise.resolve()
  }),
  mockKeys: vi.fn(() => Promise.resolve([...store.keys()])),
}))

vi.mock('idb-keyval', () => ({
  get: mockGet,
  set: mockSet,
  del: mockDel,
  keys: mockKeys,
}))

import { renderHook, act } from '@testing-library/react'
import { useLocalLists } from './useLocalLists'

describe('useLocalLists', () => {
  beforeEach(() => {
    store.clear()
    mockGet.mockImplementation((key: string) => Promise.resolve(store.get(key)))
    mockKeys.mockImplementation(() => Promise.resolve([...store.keys()]))
  })

  it('starts with empty list', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})
    expect(result.current.lists).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('creates a list', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let created: Awaited<ReturnType<typeof result.current.createList>> | undefined
    await act(async () => {
      created = await result.current.createList({
        name: 'Test List',
        source: { type: 'scratch' },
      })
    })

    expect(created).toBeDefined()
    expect(created!.name).toBe('Test List')
    expect(created!.tokens).toEqual([])
    expect(created!.description).toBe('')
    expect(result.current.lists).toHaveLength(1)
  })

  it('creates a list with description and tokens', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let created: Awaited<ReturnType<typeof result.current.createList>> | undefined
    await act(async () => {
      created = await result.current.createList({
        name: 'With Desc',
        description: 'A test list',
        source: { type: 'fork', remoteProvider: 'provA', remoteKey: 'listA' },
        tokens: [
          { chainId: 1, address: '0xabc', name: 'A', symbol: 'A', decimals: 18, order: 0 },
        ],
      })
    })

    expect(created!.description).toBe('A test list')
    expect(created!.source.type).toBe('fork')
    expect(created!.tokens).toHaveLength(1)
  })

  it('adds a token to a list', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let list: Awaited<ReturnType<typeof result.current.createList>> | undefined
    await act(async () => {
      list = await result.current.createList({
        name: 'Test',
        source: { type: 'scratch' },
      })
    })

    await act(async () => {
      await result.current.addToken(list!.id, {
        chainId: 1,
        address: '0xabc',
        name: 'Token',
        symbol: 'TKN',
        decimals: 18,
      })
    })

    expect(result.current.lists[0].tokens).toHaveLength(1)
    expect(result.current.lists[0].tokens[0].address).toBe('0xabc')
    expect(result.current.lists[0].tokens[0].order).toBe(0)
  })

  it('assigns sequential order values when adding tokens', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let list: Awaited<ReturnType<typeof result.current.createList>> | undefined
    await act(async () => {
      list = await result.current.createList({
        name: 'Test',
        source: { type: 'scratch' },
      })
    })

    await act(async () => {
      await result.current.addToken(list!.id, {
        chainId: 1,
        address: '0xabc',
        name: 'A',
        symbol: 'A',
        decimals: 18,
      })
    })

    await act(async () => {
      await result.current.addToken(list!.id, {
        chainId: 1,
        address: '0xdef',
        name: 'B',
        symbol: 'B',
        decimals: 18,
      })
    })

    expect(result.current.lists[0].tokens[0].order).toBe(0)
    expect(result.current.lists[0].tokens[1].order).toBe(1)
  })

  it('removes a token from a list', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let list: Awaited<ReturnType<typeof result.current.createList>> | undefined
    await act(async () => {
      list = await result.current.createList({
        name: 'Test',
        source: { type: 'scratch' },
        tokens: [
          { chainId: 1, address: '0xabc', name: 'A', symbol: 'A', decimals: 18, order: 0 },
          { chainId: 1, address: '0xdef', name: 'B', symbol: 'B', decimals: 18, order: 1 },
        ],
      })
    })

    await act(async () => {
      await result.current.removeToken(list!.id, '0xabc')
    })

    expect(result.current.lists[0].tokens).toHaveLength(1)
    expect(result.current.lists[0].tokens[0].address).toBe('0xdef')
  })

  it('removes tokens case-insensitively', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let list: Awaited<ReturnType<typeof result.current.createList>> | undefined
    await act(async () => {
      list = await result.current.createList({
        name: 'Test',
        source: { type: 'scratch' },
        tokens: [
          { chainId: 1, address: '0xAbC', name: 'A', symbol: 'A', decimals: 18, order: 0 },
        ],
      })
    })

    await act(async () => {
      await result.current.removeToken(list!.id, '0xabc')
    })

    expect(result.current.lists[0].tokens).toHaveLength(0)
  })

  it('deletes a list', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let list: Awaited<ReturnType<typeof result.current.createList>> | undefined
    await act(async () => {
      list = await result.current.createList({
        name: 'Test',
        source: { type: 'scratch' },
      })
    })

    await act(async () => {
      await result.current.deleteList(list!.id)
    })

    expect(result.current.lists).toHaveLength(0)
  })

  it('reorders tokens', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let list: Awaited<ReturnType<typeof result.current.createList>> | undefined
    await act(async () => {
      list = await result.current.createList({
        name: 'Test',
        source: { type: 'scratch' },
        tokens: [
          { chainId: 1, address: '0xa', name: 'A', symbol: 'A', decimals: 18, order: 0 },
          { chainId: 1, address: '0xb', name: 'B', symbol: 'B', decimals: 18, order: 1 },
          { chainId: 1, address: '0xc', name: 'C', symbol: 'C', decimals: 18, order: 2 },
        ],
      })
    })

    // Move C to first position
    const reordered = [
      list!.tokens[2], // C
      list!.tokens[0], // A
      list!.tokens[1], // B
    ]

    await act(async () => {
      await result.current.reorderTokens(list!.id, reordered)
    })

    expect(result.current.lists[0].tokens[0].address).toBe('0xc')
    expect(result.current.lists[0].tokens[0].order).toBe(0)
    expect(result.current.lists[0].tokens[1].address).toBe('0xa')
    expect(result.current.lists[0].tokens[1].order).toBe(1)
    expect(result.current.lists[0].tokens[2].address).toBe('0xb')
    expect(result.current.lists[0].tokens[2].order).toBe(2)
  })

  it('updates a list name and description', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let list: Awaited<ReturnType<typeof result.current.createList>> | undefined
    await act(async () => {
      list = await result.current.createList({
        name: 'Original',
        source: { type: 'scratch' },
      })
    })

    await act(async () => {
      await result.current.updateList(list!.id, {
        name: 'Renamed',
        description: 'Added description',
      })
    })

    expect(result.current.lists[0].name).toBe('Renamed')
    expect(result.current.lists[0].description).toBe('Added description')
  })

  it('returns null when adding token to nonexistent list', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let returned: unknown
    await act(async () => {
      returned = await result.current.addToken('nonexistent-id', {
        chainId: 1,
        address: '0xabc',
        name: 'Token',
        symbol: 'TKN',
        decimals: 18,
      })
    })

    expect(returned).toBeNull()
  })

  it('persists data to idb-keyval store', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    await act(async () => {
      await result.current.createList({
        name: 'Persisted',
        source: { type: 'scratch' },
      })
    })

    // The store should have one entry with the gib-list: prefix
    const storeKeys = [...store.keys()]
    expect(storeKeys).toHaveLength(1)
    expect(storeKeys[0]).toMatch(/^gib-list:/)
  })

  it('loads existing lists from store on mount', async () => {
    // Pre-populate the store
    const listId = 'pre-existing-id'
    store.set(`gib-list:${listId}`, {
      id: listId,
      name: 'Pre-existing',
      description: '',
      tokens: [],
      source: { type: 'scratch' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })

    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    expect(result.current.lists).toHaveLength(1)
    expect(result.current.lists[0].name).toBe('Pre-existing')
  })

  it('loadAll catch: logs error when idb-keyval keys() rejects', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loadError = new Error('IDB unavailable')
    mockKeys.mockRejectedValueOnce(loadError)

    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to load local lists:', loadError)
    expect(result.current.isLoading).toBe(false)
    consoleErrorSpy.mockRestore()
  })

  it('getList returns the list when it exists in IDB', async () => {
    const listId = 'known-id'
    const listData = {
      id: listId,
      name: 'Known List',
      description: '',
      tokens: [],
      source: { type: 'scratch' as const },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }
    store.set(`gib-list:${listId}`, listData)

    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let fetched: Awaited<ReturnType<typeof result.current.getList>> | undefined
    await act(async () => {
      fetched = await result.current.getList(listId)
    })

    expect(fetched).toEqual(listData)
  })

  it('getList returns null when list does not exist in IDB', async () => {
    const { result } = renderHook(() => useLocalLists())
    await act(async () => {})

    let fetched: Awaited<ReturnType<typeof result.current.getList>> | undefined
    await act(async () => {
      fetched = await result.current.getList('nonexistent-id')
    })

    expect(fetched).toBeNull()
  })
})
