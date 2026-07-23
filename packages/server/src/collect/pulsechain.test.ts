import { describe, expect, it, vi } from 'vitest'

const insertProvider = vi.fn()
vi.mock('../db', () => ({ insertProvider: (...args: unknown[]) => insertProvider(...args) }))

import pulsechainCollector, { collect } from './pulsechain'

describe('pulsechainCollector.discover', () => {
  it('registers the PulseChain provider and hands back an empty manifest for it', async () => {
    const signal = new AbortController().signal
    const manifest = await pulsechainCollector.discover(signal)

    // discover() is Phase 1 — it must only register the provider row, never
    // fetch tokens. The manifest carries the provider key forward so
    // syncDefaultOrder still allots it a ranking tier even though it has no lists.
    expect(insertProvider).toHaveBeenCalledWith({
      key: 'pulsechain',
      name: 'PulseChain',
      description: 'a grass roots list curated by pulsechain devs',
    })
    expect(manifest).toEqual([{ providerKey: 'pulsechain', lists: [] }])
  })
})

describe('collect', () => {
  it('delegates to the singleton collector instance', async () => {
    const signal = new AbortController().signal
    const spy = vi.spyOn(pulsechainCollector, 'collect')

    await expect(collect(signal)).resolves.toBeUndefined()

    expect(spy).toHaveBeenCalledWith(signal)
  })
})
