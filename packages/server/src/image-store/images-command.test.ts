import { describe, expect, it, vi } from 'vitest'
import type { VerifySummary } from './backfill'
import { runImagesCommand, type ImagesOperations } from './images-command'

vi.mock('./backfill', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./backfill')>()),
  exportImages: vi.fn(async () => ({ examined: 0, exported: 0, empty: 0, skipped: 0, bytes: 0 })),
  verifyImages: vi.fn(async () => ({ ok: true })),
  importImages: vi.fn(async () => ({ examined: 0, restored: 0, missingFiles: 0, skipped: 0 })),
}))
vi.mock('./garbage-collection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./garbage-collection')>()),
  collectGarbage: vi.fn(async () => ({ dryRun: true })),
}))

const okVerify = { ok: true } as unknown as VerifySummary

const setup = () => {
  const printed: string[] = []
  const errors: string[] = []
  const operations: ImagesOperations = {
    exportImages: vi.fn(async () => ({ examined: 3, exported: 2, empty: 1, skipped: 0, bytes: 10 })),
    verifyImages: vi.fn(async () => okVerify),
    importImages: vi.fn(async () => ({ examined: 4, restored: 4, missingFiles: 0, skipped: 0 })),
    collectGarbage: vi.fn(async () => ({
      dryRun: true,
      scanned: 0,
      referenced: 0,
      tooRecent: 0,
      unreferenced: 0,
      deleted: 0,
      unreferencedBytes: 0,
    })),
  }
  const output = { print: (text: string) => printed.push(text), printError: (text: string) => errors.push(text) }
  return { operations, output, printed, errors }
}

describe('runImagesCommand', () => {
  it('runs export with its defaults and prints the summary as JSON', async () => {
    const { operations, output, printed } = setup()

    const exitCode = await runImagesCommand(['export'], { operations, output })

    expect(exitCode).toBe(0)
    expect(operations.exportImages).toHaveBeenCalledWith({ batchSize: 50, sleepMs: 0 })
    expect(JSON.parse(printed[0])).toEqual({ examined: 3, exported: 2, empty: 1, skipped: 0, bytes: 10 })
  })

  it('passes the batch size and the pause through to export and to import', async () => {
    const { operations, output } = setup()

    await runImagesCommand(['export', '--batch-size', '10', '--sleep-ms', '200'], { operations, output })
    await runImagesCommand(['import', '--batch-size', '5', '--sleep-ms', '30'], { operations, output })

    expect(operations.exportImages).toHaveBeenCalledWith({ batchSize: 10, sleepMs: 200 })
    expect(operations.importImages).toHaveBeenCalledWith({ batchSize: 5, sleepMs: 30 })
  })

  it('runs import and prints its summary', async () => {
    const { operations, output, printed } = setup()

    expect(await runImagesCommand(['import'], { operations, output })).toBe(0)
    expect(JSON.parse(printed[0])).toMatchObject({ restored: 4 })
  })

  it('exits 0 when verify is ok and 1 when it is not, printing the summary either way', async () => {
    const good = setup()
    expect(await runImagesCommand(['verify'], good)).toBe(0)
    expect(good.operations.verifyImages).toHaveBeenCalledWith({ rehash: false })

    const bad = setup()
    bad.operations.verifyImages = vi.fn(
      async () => ({ ok: false, missingFiles: ['a'.repeat(64)] }) as unknown as VerifySummary,
    )
    expect(await runImagesCommand(['verify', '--rehash'], bad)).toBe(1)
    expect(bad.operations.verifyImages).toHaveBeenCalledWith({ rehash: true })
    expect(JSON.parse(bad.printed[0])).toMatchObject({ ok: false })
  })

  it('makes gc a dry run with a seven-day grace period unless told otherwise', async () => {
    const { operations, output } = setup()

    await runImagesCommand(['gc'], { operations, output })

    expect(operations.collectGarbage).toHaveBeenCalledWith({ dryRun: true, gracePeriodMs: 7 * 24 * 60 * 60 * 1000 })
  })

  it('accepts --dry-run, deletes only with --no-dry-run, and takes the grace period in days', async () => {
    const { operations, output } = setup()

    await runImagesCommand(['gc', '--dry-run'], { operations, output })
    await runImagesCommand(['gc', '--no-dry-run', '--grace-days', '2'], { operations, output })

    expect(operations.collectGarbage).toHaveBeenNthCalledWith(1, { dryRun: true, gracePeriodMs: 7 * 86_400_000 })
    expect(operations.collectGarbage).toHaveBeenNthCalledWith(2, { dryRun: false, gracePeriodMs: 2 * 86_400_000 })
  })

  it.each([[[]], [['nonsense']], [['export', '--no-such-option']]])(
    'prints the problem and exits 1 for arguments %j, running nothing',
    async (args) => {
      const { operations, output, errors } = setup()

      expect(await runImagesCommand(args, { operations, output })).toBe(1)

      expect(errors.length).toBeGreaterThan(0)
      expect(operations.exportImages).not.toHaveBeenCalled()
      expect(operations.collectGarbage).not.toHaveBeenCalled()
    },
  )

  it('prints the message and exits 1 when an operation throws', async () => {
    const { operations, output, errors } = setup()
    operations.exportImages = vi.fn(async () => {
      throw new Error('connection refused')
    })

    expect(await runImagesCommand(['export'], { operations, output })).toBe(1)
    expect(errors).toContain('connection refused')
  })

  it('prints a thrown value that is not an error as text', async () => {
    const { operations, output, errors } = setup()
    operations.exportImages = vi.fn(async () => {
      throw 'plain text'
    })

    expect(await runImagesCommand(['export'], { operations, output })).toBe(1)
    expect(errors).toContain('plain text')
  })

  it('runs the real operations and prints to the console when none are passed', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await runImagesCommand(['export'])).toBe(0)
    expect(await runImagesCommand(['verify'])).toBe(0)
    expect(await runImagesCommand(['import'])).toBe(0)
    expect(await runImagesCommand(['gc'])).toBe(0)
    expect(await runImagesCommand(['nonsense'])).toBe(1)

    expect(log).toHaveBeenCalledTimes(4)
    expect(error).toHaveBeenCalled()
    log.mockRestore()
    error.mockRestore()
  })
})
