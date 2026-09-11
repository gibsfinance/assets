/**
 * Behavioral tests for ListEditorContext — the state machine behind the list editor
 * drawer.
 *
 * Why: `openEditor` is the one entry point every "edit this list" action in the
 * Studio goes through, and it has to tell apart two different kinds of argument —
 * a remote source key such as "gib/default" and a local list's own id — because
 * only one of them needs a lookup against the lists already saved on this device.
 * Get that lookup wrong and a user reopening a list they already forked starts a
 * second, disconnected copy instead of picking the fork back up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// idb-keyval mock — ListEditorProvider persists local lists through useLocalLists,
// which reads and writes IndexedDB. Backed by an in-memory Map, the same pattern
// useLocalLists.test.ts and StudioBrowser.test.tsx use.
// ---------------------------------------------------------------------------
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

import { ListEditorProvider, useListEditor } from './ListEditorContext'

const wrapper = ({ children }: { children: ReactNode }) => createElement(ListEditorProvider, null, children)

const renderListEditor = () => renderHook(() => useListEditor(), { wrapper })

beforeEach(() => {
  idbStore.clear()
})

// ---------------------------------------------------------------------------
// Provider guard
// ---------------------------------------------------------------------------

describe('useListEditor guard', () => {
  it('throws a clear error when used outside a ListEditorProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useListEditor())).toThrow('useListEditor must be used within ListEditorProvider')
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// openEditor — telling a remote source key apart from a local list id
// ---------------------------------------------------------------------------

describe('openEditor with a remote source key', () => {
  it('opens with no active list when no local fork of that source exists yet', async () => {
    // A source key such as "gib/default" is not a local list id, so it must never be
    // looked up as one — and with nothing forked yet, the editor opens empty rather
    // than crashing or attaching to an unrelated list.
    const { result } = renderListEditor()
    await act(async () => {})

    act(() => {
      result.current.openEditor('gib/default')
    })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.editingListId).toBeNull()
    expect(result.current.editingSourceKey).toBe('gib/default')
    expect(result.current.activeList).toBeNull()
  })

  it('resumes editing the local fork of that exact source, not a fork of a different one', async () => {
    // Two forks can sit side by side in local storage. Matching the wrong one reopens
    // someone else's edits under the name of the list the user actually clicked.
    const { result } = renderListEditor()
    await act(async () => {})

    let otherFork: Awaited<ReturnType<typeof result.current.createList>>
    let partialMatchFork: Awaited<ReturnType<typeof result.current.createList>>
    let matchingFork: Awaited<ReturnType<typeof result.current.createList>>
    await act(async () => {
      otherFork = await result.current.createList({
        name: 'Someone else’s fork',
        source: { type: 'fork', remoteProvider: 'otherProvider', remoteKey: 'otherKey' },
      })
      // Shares the provider with the source key being opened, but not the key. Matching
      // on the provider alone would pick this fork instead of the one actually asked for.
      partialMatchFork = await result.current.createList({
        name: 'A different list from the same provider',
        source: { type: 'fork', remoteProvider: 'gib', remoteKey: 'a-different-list' },
      })
      matchingFork = await result.current.createList({
        name: 'My fork',
        source: { type: 'fork', remoteProvider: 'gib', remoteKey: 'default' },
      })
    })

    act(() => {
      result.current.openEditor('gib/default')
    })

    expect(result.current.editingListId).toBe(matchingFork!.id)
    expect(result.current.editingListId).not.toBe(otherFork!.id)
    expect(result.current.editingListId).not.toBe(partialMatchFork!.id)
    expect(result.current.activeList?.id).toBe(matchingFork!.id)
    expect(result.current.editingSourceKey).toBe('gib/default')
  })
})

describe('openEditor with a local list id', () => {
  it('opens the named list directly, without treating the id as a source key', async () => {
    // A plain id carries no slash, so it must skip the remote-fork lookup entirely and
    // attach straight to the list it names.
    const { result } = renderListEditor()
    await act(async () => {})

    let list: Awaited<ReturnType<typeof result.current.createList>>
    await act(async () => {
      list = await result.current.createList({ name: 'Scratch list', source: { type: 'scratch' } })
    })

    act(() => {
      result.current.openEditor(list!.id)
    })

    expect(result.current.editingListId).toBe(list!.id)
    expect(result.current.editingSourceKey).toBeNull()
    expect(result.current.activeList?.id).toBe(list!.id)
  })
})

// ---------------------------------------------------------------------------
// closeEditor — returns the drawer to its closed, unattached state
// ---------------------------------------------------------------------------

describe('closeEditor', () => {
  it('closes the drawer and drops the active list and source key', async () => {
    // Leaving editingListId set after close would reattach the editor to a stale
    // list the next time it opens through some other path.
    const { result } = renderListEditor()
    await act(async () => {})

    act(() => {
      result.current.openEditor('gib/default')
    })
    expect(result.current.isOpen).toBe(true)

    act(() => {
      result.current.closeEditor()
    })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.editingListId).toBeNull()
    expect(result.current.editingSourceKey).toBeNull()
    expect(result.current.activeList).toBeNull()
  })
})
