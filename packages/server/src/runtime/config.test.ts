import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SETTINGS = [
  'COLLECT_PROVIDER_CONCURRENCY',
  'IMAGE_FETCH_CONCURRENCY',
  'IMAGE_PREWARM_CONCURRENCY',
  'SHARP_CACHE_MEMORY_MB',
  'SHARP_CACHE_ITEMS',
  'SHARP_CONCURRENCY',
  'IMAGE_STORE_DIR',
  'IMAGE_BYTES_IN_DATABASE',
  'ETHERSCAN_API_KEY',
  'ETHERSCAN_CALLS_PER_SECOND',
]

/** Loads `config.ts` afresh, because it reads the environment once, when it is first imported. */
const loadConfig = async () => {
  vi.resetModules()
  return (await import('../../config')).default
}

beforeEach(() => {
  for (const name of SETTINGS) vi.stubEnv(name, undefined as unknown as string)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('config: limits an operator can set', () => {
  it('keeps the values the code used before they were settable, when nothing is set', async () => {
    const config = await loadConfig()

    expect(config.concurrency).toEqual({ providers: 4, imageFetches: 8, imagePrewarm: 8 })
    expect(config.sharp).toEqual({ cacheMemoryMegabytes: 16, cacheItems: 64, concurrency: 1 })
  })

  it('takes each limit from its own variable', async () => {
    vi.stubEnv('COLLECT_PROVIDER_CONCURRENCY', '2')
    vi.stubEnv('IMAGE_FETCH_CONCURRENCY', '3')
    vi.stubEnv('IMAGE_PREWARM_CONCURRENCY', '5')
    vi.stubEnv('SHARP_CACHE_MEMORY_MB', '8')
    vi.stubEnv('SHARP_CACHE_ITEMS', '32')
    vi.stubEnv('SHARP_CONCURRENCY', '2')

    const config = await loadConfig()

    expect(config.concurrency).toEqual({ providers: 2, imageFetches: 3, imagePrewarm: 5 })
    expect(config.sharp).toEqual({ cacheMemoryMegabytes: 8, cacheItems: 32, concurrency: 2 })
  })

  it('ignores a value that is not a whole number of at least one, rather than switching the limit off', async () => {
    vi.stubEnv('COLLECT_PROVIDER_CONCURRENCY', '0')
    vi.stubEnv('IMAGE_FETCH_CONCURRENCY', 'lots')
    vi.stubEnv('SHARP_CONCURRENCY', '-1')

    const config = await loadConfig()

    expect(config.concurrency.providers).toBe(4)
    expect(config.concurrency.imageFetches).toBe(8)
    expect(config.sharp.concurrency).toBe(1)
  })
})

describe('config: image store directory', () => {
  it('defaults to a directory in the repository root', async () => {
    const config = await loadConfig()

    const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    expect(config.imageStoreDirectory).toBe(path.join(repositoryRoot, 'image-store'))
  })

  it('uses IMAGE_STORE_DIR, made absolute', async () => {
    vi.stubEnv('IMAGE_STORE_DIR', '/srv/images')
    expect((await loadConfig()).imageStoreDirectory).toBe('/srv/images')

    vi.stubEnv('IMAGE_STORE_DIR', 'relative/place')
    expect((await loadConfig()).imageStoreDirectory).toBe(path.resolve('relative/place'))
  })
})

describe('config: bytes in the database', () => {
  it('keeps writing them when nothing is set, so a deploy changes nothing until the operator says so', async () => {
    expect((await loadConfig()).imageBytesInDatabase).toBe(true)
  })

  it('stops writing them when IMAGE_BYTES_IN_DATABASE is false', async () => {
    vi.stubEnv('IMAGE_BYTES_IN_DATABASE', 'false')
    expect((await loadConfig()).imageBytesInDatabase).toBe(false)
  })

  it('ignores a value it does not recognise, rather than flipping the switch', async () => {
    vi.stubEnv('IMAGE_BYTES_IN_DATABASE', 'flase')
    expect((await loadConfig()).imageBytesInDatabase).toBe(true)
  })
})

describe('config: etherscan', () => {
  it('leaves the collector off, at the free plan rate, when nothing is set', async () => {
    const { etherscan } = await loadConfig()
    expect(etherscan.apiKey).toBeUndefined()
    expect(etherscan.callsPerSecond).toBe(3)
  })

  it('reads the key and the rate from the environment', async () => {
    vi.stubEnv('ETHERSCAN_API_KEY', 'a-key')
    vi.stubEnv('ETHERSCAN_CALLS_PER_SECOND', '10')
    const { etherscan } = await loadConfig()
    expect(etherscan.apiKey).toBe('a-key')
    expect(etherscan.callsPerSecond).toBe(10)
  })
})
