// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import networksJson from '../networks.json'

const generated = networksJson as Record<string, string>
/** A chain only the vendored table names: no curated entry, and not a registryName. */
const tableOnlyId = '5'

/** Fresh module state per test: the table cache lives at module level. */
const loadFresh = () => import('./network-name')

describe('network name table loading', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('../networks.json')
  })

  it('skips the table tier before load and uses it after', async () => {
    const { getNetworkName, loadNetworkNameTable } = await loadFresh()
    expect(generated[tableOnlyId]).toBeTruthy()
    expect(getNetworkName(tableOnlyId)).toBe(`Chain ${tableOnlyId}`)
    await loadNetworkNameTable()
    expect(getNetworkName(tableOnlyId)).toBe(generated[tableOnlyId])
  })

  it('keeps the registry name ahead of the table in both states', async () => {
    const { getNetworkName, loadNetworkNameTable } = await loadFresh()
    expect(getNetworkName(tableOnlyId, { registryName: 'Server Name' })).toBe('Server Name')
    await loadNetworkNameTable()
    expect(getNetworkName(tableOnlyId, { registryName: 'Server Name' })).toBe('Server Name')
  })

  it('keeps curated names unchanged in both states', async () => {
    const { getNetworkName, loadNetworkNameTable } = await loadFresh()
    expect(getNetworkName(1)).toBe('Ethereum')
    expect(getNetworkName('bip122-0')).toBe('Bitcoin')
    await loadNetworkNameTable()
    expect(getNetworkName(1)).toBe('Ethereum')
    expect(getNetworkName('bip122-0')).toBe('Bitcoin')
  })

  it('shares one load between callers and resolves instantly once cached', async () => {
    const { loadNetworkNameTable } = await loadFresh()
    const first = loadNetworkNameTable()
    expect(loadNetworkNameTable()).toBe(first)
    const table = await first
    expect(await loadNetworkNameTable()).toBe(table)
  })

  it('re-renders a hook user exactly once when the table lands', async () => {
    const { useNetworkNameTable, getNetworkName } = await loadFresh()
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return { table: useNetworkNameTable(), name: getNetworkName(tableOnlyId) }
    })
    expect(result.current.table).toBeNull()
    expect(result.current.name).toBe(`Chain ${tableOnlyId}`)
    const rendersBeforeLanding = renders
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(result.current.table).not.toBeNull()
    expect(result.current.name).toBe(generated[tableOnlyId])
    expect(renders - rendersBeforeLanding).toBe(1)
  })

  it('stops notifying an unmounted hook user', async () => {
    const { useNetworkNameTable, loadNetworkNameTable } = await loadFresh()
    const { unmount } = renderHook(() => useNetworkNameTable())
    unmount()
    await expect(loadNetworkNameTable()).resolves.not.toBeNull()
  })

  it('resolves null and allows a retry when the chunk fails to load', async () => {
    vi.doMock('../networks.json', () => {
      throw new Error('chunk failed')
    })
    const { loadNetworkNameTable, getNetworkName } = await loadFresh()
    await expect(loadNetworkNameTable()).resolves.toBeNull()
    expect(getNetworkName(tableOnlyId)).toBe(`Chain ${tableOnlyId}`)
    vi.doUnmock('../networks.json')
    vi.resetModules()
    const retry = await loadFresh()
    await expect(retry.loadNetworkNameTable()).resolves.not.toBeNull()
  })
})
