import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, createLogAppMock } from './__testing__/drizzle-harness'

const harness = createDrizzleHarness()
vi.mock('./drizzle', () => ({ getDrizzle: () => harness.db }))
vi.mock('../log/App', () => createLogAppMock())

// Static imports so the module graph loads once during file setup rather than
// inside a test's own timeout budget — see index.order.test.ts.
import { insertBridge, insertBridgeLink, updateBridgeBlockProgress, getBridge, getLatestBridgeToken } from './index'

beforeEach(() => {
  harness.reset()
})

// ---------------------------------------------------------------------------
// insertBridge
// ---------------------------------------------------------------------------

describe('insertBridge', () => {
  it('checksums both home and foreign addresses before insert', async () => {
    harness.queueResult([{ bridgeId: 'bridge-1' }])

    await insertBridge({
      type: 'omnibridge',
      providerId: 'provider-1',
      homeNetworkId: 'network-1',
      homeAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      foreignNetworkId: 'network-2',
      foreignAddress: '0x1234567890123456789012345678901234567890',
    })

    const insertQuery = harness.queries[0]
    const row = insertQuery.steps.find((step) => step.method === 'values')?.args[0] as {
      homeAddress: string
      foreignAddress: string
    }
    // Unlike token providedId (lowercased), bridge addresses must land
    // checksummed — the bridge_id trigger hashes the address text
    // case-sensitively, and every existing row was inserted checksummed.
    // Lowercasing here would mint a fresh bridge_id and zero its block progress.
    expect(row.homeAddress).toBe('0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD')
    expect(row.foreignAddress).toBe('0x1234567890123456789012345678901234567890')
  })
})

describe('insertBridgeLink', () => {
  it('conflicts on bridgeLinkId, re-asserting it to itself so RETURNING yields the existing row', async () => {
    harness.queueResult([{ bridgeLinkId: 'link-1' }])

    await insertBridgeLink({
      nativeTokenId: 'token-1',
      bridgedTokenId: 'token-2',
      bridgeId: 'bridge-1',
      transactionHash: '0xhash',
    })

    const insertQuery = harness.queries[0]
    const conflictStep = insertQuery.steps.find((step) => step.method === 'onConflictDoUpdate')
    const conflictArgs = conflictStep?.args[0] as { set: Record<string, unknown> }
    expect(Object.keys(conflictArgs.set)).toEqual(['bridgeLinkId'])
  })
})

describe('updateBridgeBlockProgress', () => {
  it('scopes the update to the given bridgeId', async () => {
    harness.queueResult([{ bridgeId: 'bridge-1' }])

    await updateBridgeBlockProgress('bridge-1', { currentHomeBlockNumber: 500 })

    const updateQuery = harness.queries[0]
    const setStep = updateQuery.steps.find((step) => step.method === 'set')
    expect(setStep?.args[0]).toEqual({ currentHomeBlockNumber: 500 })
    // Without a WHERE clause every bridge's checkpoint would advance together,
    // corrupting every other bridge's event-scan progress.
    expect(updateQuery.steps.some((step) => step.method === 'where')).toBe(true)
  })
})

describe('getBridge', () => {
  it('returns undefined when the bridge id does not exist', async () => {
    harness.queueResult([])
    const result = await getBridge('missing-bridge')
    expect(result).toBeUndefined()
  })
})

describe('getLatestBridgeToken', () => {
  it('counts bridged tokens ordered by the most recently created bridge link', async () => {
    harness.queueResult([{ count: 3 }])

    const result = await getLatestBridgeToken('bridge-1')

    const selectQuery = harness.queries[0]
    expect(selectQuery.steps.some((step) => step.method === 'orderBy')).toBe(true)
    expect(result).toEqual({ count: 3 })
  })
})
