import { describe, expect, it, vi } from 'vitest'

const printFailures = vi.fn()
vi.mock('./utils', () => ({ printFailures: () => printFailures() }))

const cancelAllRequests = vi.fn()
vi.mock('@gibs/utils/fetch', () => ({ cancelAllRequests: () => cancelAllRequests() }))

const destroyTerminal = vi.fn()
vi.mock('./log/App', () => ({ destroyTerminal: () => destroyTerminal() }))

let releaseCloseDb: () => void = () => {}
const closeDb = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      releaseCloseDb = resolve
    }),
)
vi.mock('./db/drizzle', () => ({ closeDb: () => closeDb() }))

import { cleanup } from './cleanup'

describe('cleanup', () => {
  it('runs every shutdown step and waits for the database to finish closing', async () => {
    let settled = false
    const done = cleanup().then(() => {
      settled = true
    })

    // Flush microtasks so the synchronous steps have a chance to run before the
    // database close resolves.
    await Promise.resolve()
    await Promise.resolve()

    expect(printFailures).toHaveBeenCalledTimes(1)
    expect(cancelAllRequests).toHaveBeenCalledTimes(1)
    expect(destroyTerminal).toHaveBeenCalledTimes(1)
    expect(closeDb).toHaveBeenCalledTimes(1)
    // The whole point of `await closeDb()` is that cleanup() does not resolve
    // until the connection pool actually finishes closing — otherwise a caller
    // that exits right after cleanup() could race a still-open connection.
    expect(settled).toBe(false)

    releaseCloseDb()
    await done
    expect(settled).toBe(true)
  })
})
