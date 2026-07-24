import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

// getTokenList() assumes the harvested fixture always carries at least one
// domain entry and throws a guard error otherwise. Isolated in its own file
// (rather than added to phux.test.ts) because it needs the harvested fixture
// itself replaced with an empty object, which would break every other test
// in that file if the mock were shared.
vi.mock('../harvested/phux/369', () => ({ default: {} }))

beforeEach(() => {
  harness.reset()
})

import phux from './phux'

describe('phux collector with an empty harvested fixture', () => {
  it('throws its defensive guard rather than silently registering an empty list', async () => {
    // If the harvested fixture were ever regenerated empty, silently doing
    // nothing would leave phux's list stuck at whatever it last held; failing
    // loudly here is what makes that regression visible.
    await expect(phux.discover(new AbortController().signal)).rejects.toThrow('should never get here')
  })
})
