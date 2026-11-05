import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

const drizzle = vi.fn()
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: (...args: unknown[]) => drizzle(...args) }))

const drizzleMigrate = vi.fn()
vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: (...args: unknown[]) => drizzleMigrate(...args) }))

const { configMock } = vi.hoisted(() => ({
  configMock: { database: { url: 'postgres://test/db', ssl: false } },
}))
vi.mock('../../config', () => ({ default: configMock }))

describe('db/drizzle', () => {
  // Load the module graph once, outside any test's budget — see the note in
  // chains.test.ts. Every test here resets the registry and re-imports, so
  // without this the first one absorbs the whole transform-and-load cost.
  beforeAll(async () => {
    await import('./drizzle').catch(() => {})
  }, 60_000)

  beforeEach(() => {
    vi.resetModules()
    drizzle.mockReset()
    drizzleMigrate.mockReset()
    configMock.database.ssl = false
  })

  afterEach(() => {
    configMock.database.ssl = false
  })

  it('disables ssl when configuration.database.ssl is false', async () => {
    const fakeDb = { $client: { end: vi.fn() } }
    drizzle.mockReturnValue(fakeDb)

    await import('./drizzle')

    const [options] = drizzle.mock.calls[0] as [{ connection: { ssl: unknown } }]
    expect(options.connection.ssl).toBe(false)
  })

  it('requests an unverified TLS connection when configuration.database.ssl is true', async () => {
    configMock.database.ssl = true
    const fakeDb = { $client: { end: vi.fn() } }
    drizzle.mockReturnValue(fakeDb)

    await import('./drizzle')

    const [options] = drizzle.mock.calls[0] as [{ connection: { ssl: unknown } }]
    // Managed Postgres providers (Railway, RDS) commonly present a cert the
    // Node trust store cannot validate; rejectUnauthorized:false is what makes
    // `ssl: true` actually usable against them rather than failing every query.
    expect(options.connection.ssl).toEqual({ rejectUnauthorized: false })
  })

  it('getDrizzle returns the same singleton instance the module built at load time', async () => {
    const fakeDb = { $client: { end: vi.fn() } }
    drizzle.mockReturnValue(fakeDb)

    const { getDrizzle } = await import('./drizzle')

    expect(getDrizzle()).toBe(fakeDb)
    expect(getDrizzle()).toBe(getDrizzle())
  })

  it('closeDb ends the underlying client connection', async () => {
    const end = vi.fn().mockResolvedValue(undefined)
    drizzle.mockReturnValue({ $client: { end } })

    const { closeDb } = await import('./drizzle')
    await closeDb()

    expect(end).toHaveBeenCalledTimes(1)
  })

  /** A pool whose one client records every call, in order, into `calls`. */
  const fakeLockingDb = (options: { unlockFails?: boolean } = {}) => {
    const calls: string[] = []
    const lockClient = {
      query: vi.fn(async (text: string) => {
        calls.push(text.includes('unlock') ? 'unlock' : 'lock')
        if (text.includes('unlock') && options.unlockFails) throw new Error('connection lost')
      }),
      release: vi.fn((destroy?: boolean) => calls.push(destroy ? 'release:destroy' : 'release')),
    }
    const fakeDb = { $client: { end: vi.fn(), connect: vi.fn(async () => lockClient) } }
    drizzleMigrate.mockImplementation(async () => {
      calls.push('migrate')
    })
    return { fakeDb, lockClient, calls }
  }

  it('migrate holds an advisory lock for the whole run, so two processes cannot race', async () => {
    const { fakeDb, lockClient, calls } = fakeLockingDb()
    drizzle.mockReturnValue(fakeDb)

    const { migrate, MIGRATION_LOCK_KEY } = await import('./drizzle')
    await migrate()

    expect(calls).toEqual(['lock', 'migrate', 'unlock', 'release'])
    expect(lockClient.query).toHaveBeenNthCalledWith(1, 'SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    expect(lockClient.query).toHaveBeenNthCalledWith(2, 'SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
  })

  it('migrate unlocks and returns the connection when a migration fails', async () => {
    const { fakeDb, calls } = fakeLockingDb()
    drizzle.mockReturnValue(fakeDb)
    drizzleMigrate.mockRejectedValueOnce(new Error('bad migration'))

    const { migrate } = await import('./drizzle')
    await expect(migrate()).rejects.toThrow('bad migration')

    expect(calls).toEqual(['lock', 'unlock', 'release'])
  })

  it('migrate destroys the connection when the unlock fails, so the lock cannot stay held', async () => {
    const { fakeDb, calls } = fakeLockingDb({ unlockFails: true })
    drizzle.mockReturnValue(fakeDb)

    const { migrate } = await import('./drizzle')
    await migrate()

    expect(calls).toEqual(['lock', 'migrate', 'unlock', 'release:destroy'])
  })

  it('migrate runs pending migrations from the package-root drizzle/ directory', async () => {
    const { fakeDb } = fakeLockingDb()
    drizzle.mockReturnValue(fakeDb)

    const { migrate } = await import('./drizzle')
    await migrate()

    expect(drizzleMigrate).toHaveBeenCalledTimes(1)
    const [db, options] = drizzleMigrate.mock.calls[0] as [unknown, { migrationsFolder: string }]
    expect(db).toBe(fakeDb)
    // Locks the migrations folder to the package root's drizzle/ directory —
    // pointed anywhere else, migrate() would silently apply nothing at boot.
    expect(options.migrationsFolder.endsWith(`${path.sep}drizzle`)).toBe(true)
    expect(options.migrationsFolder).not.toContain(`${path.sep}src${path.sep}`)
  })
})
