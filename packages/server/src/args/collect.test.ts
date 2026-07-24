import { beforeEach, describe, expect, it, vi } from 'vitest'

const parse = vi.fn()
vi.mock('./utils', () => ({ parse: (...args: unknown[]) => parse(...args) }))

const allCollectables = vi.fn(() => ['gibs', 'trustwallet'])
vi.mock('../collect/collectables', () => ({ allCollectables: () => allCollectables() }))

const baseArgv = {
  providers: [] as string[],
  mode: 'mixed',
  logger: 'terminal',
  concurrency: 4,
  rpc1: [] as string[],
  rpc369: [] as string[],
  rpc56: [] as string[],
  rpc11155111: [] as string[],
  rpc943: [] as string[],
}

describe('collect', () => {
  beforeEach(() => {
    vi.resetModules()
    parse.mockReset()
    allCollectables.mockClear()
  })

  it('builds the rpc option schema with the real per-chain defaults and comma-splitting coerce', async () => {
    parse.mockReturnValue(baseArgv)
    const { collect } = await import('./collect')
    collect()

    // The object handed to parse() is the actual yargs option schema this module
    // builds — inspecting it exercises the real `rpc()` helper and its `coerce`,
    // not a re-implementation of them.
    const [, schema] = parse.mock.calls[0] as [string, Record<string, any>]
    expect(schema.rpc1.default).toEqual(['https://rpc-ethereum.g4mm4.io'])
    expect(schema.rpc369.default).toEqual(['https://rpc-pulsechain.g4mm4.io'])
    expect(schema.rpc56.default).toEqual([])
    // A CLI value can arrive as one comma-joined string; coerce must flatten it
    // back into distinct URLs or the load balancer would treat it as one bogus
    // multi-URL string.
    expect(schema.rpc1.coerce(['https://a.example,https://b.example'])).toEqual([
      'https://a.example',
      'https://b.example',
    ])
    expect(schema.providers.coerce(['gibs,trustwallet', 'coingecko'])).toEqual(['gibs', 'trustwallet', 'coingecko'])
  })

  it('uses the explicit --providers list when one is given', async () => {
    parse.mockReturnValue({ ...baseArgv, providers: ['coingecko', 'dexscreener'] })
    const { collect } = await import('./collect')

    const config = collect()

    expect(config.providers()).toEqual(['coingecko', 'dexscreener'])
    expect(allCollectables).not.toHaveBeenCalled()
  })

  it('falls back to every known collectable when --providers is empty', async () => {
    parse.mockReturnValue({ ...baseArgv, providers: [] })
    const { collect } = await import('./collect')

    const config = collect()

    // An empty --providers must mean "collect everything", not "collect nothing"
    // — the CLI treats absence and an empty array the same way.
    expect(config.providers()).toEqual(['gibs', 'trustwallet'])
    expect(allCollectables).toHaveBeenCalledTimes(1)
  })

  it('forwards mode, logger, concurrency, and rpc lists verbatim', async () => {
    parse.mockReturnValue({
      ...baseArgv,
      mode: 'save',
      logger: 'pretty',
      concurrency: 8,
      rpc1: ['https://custom-mainnet.example'],
    })
    const { collect } = await import('./collect')

    const config = collect()

    expect(config.mode).toBe('save')
    expect(config.logger).toBe('pretty')
    expect(config.concurrency).toBe(8)
    expect(config.rpc1).toEqual(['https://custom-mainnet.example'])
  })

  it('memoizes so argv is only parsed once per process', async () => {
    parse.mockReturnValue(baseArgv)
    const { collect } = await import('./collect')

    collect()
    collect()
    collect()

    expect(parse).toHaveBeenCalledTimes(1)
  })
})

describe('checkShouldSave', () => {
  beforeEach(() => {
    vi.resetModules()
    parse.mockReset()
  })

  it('always saves when mode is "save"', async () => {
    parse.mockReturnValue({ ...baseArgv, mode: 'save' })
    const { checkShouldSave } = await import('./collect')

    // Even pumptires — normally excluded — is saved under an explicit save mode.
    expect(checkShouldSave('pumptires')).toBe(true)
    expect(checkShouldSave('trustwallet')).toBe(true)
  })

  it('never saves when mode is "link"', async () => {
    parse.mockReturnValue({ ...baseArgv, mode: 'link' })
    const { checkShouldSave } = await import('./collect')

    expect(checkShouldSave('trustwallet')).toBe(false)
    expect(checkShouldSave('pumptires')).toBe(false)
  })

  it('in the default "mixed" mode, saves everything except the untrusted-by-default providers', async () => {
    parse.mockReturnValue({ ...baseArgv, mode: 'mixed' })
    const { checkShouldSave } = await import('./collect')

    // pumptires content is user-controlled, so mixed mode links to it instead
    // of copying untrusted bytes into the image store by default.
    expect(checkShouldSave('pumptires')).toBe(false)
    expect(checkShouldSave('trustwallet')).toBe(true)
  })

  it('memoizes per provider key', async () => {
    parse.mockReturnValue({ ...baseArgv, mode: 'mixed' })
    const { checkShouldSave } = await import('./collect')

    const first = checkShouldSave('trustwallet')
    const second = checkShouldSave('trustwallet')

    expect(first).toBe(second)
    // collect() itself stays memoized even though checkShouldSave calls it
    // again on every invocation.
    expect(parse).toHaveBeenCalledTimes(1)
  })
})
