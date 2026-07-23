import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('migrate runs pending migrations from the package-root drizzle/ directory', async () => {
    const fakeDb = { $client: { end: vi.fn() } }
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
