import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
// src/utils instantiates the Ink terminal renderer at module load, which cannot
// run under vitest (patch-console). An endlessly-chainable no-op stands in.
// Same pattern as src/utils/chain-id-to-network-id.test.ts.
vi.mock('../log/App', () => {
  const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => noop })
  return { createTerminal: () => noop, forceRerender: () => {} }
})

const { createChainClient, writeFileSyncMock } = vi.hoisted(() => ({
  createChainClient: vi.fn((chain: { id: number }) => ({ builtFor: chain.id })),
  writeFileSyncMock: vi.fn(),
}))
vi.mock('@gibs/utils/viem', async (importOriginal) => {
  // `@gibs/utils`'s barrel re-exports this same module for rpcEndpointUrls
  // (used by findChain below) — replacing the whole module would silently
  // break that unrelated export, so only createChainClient is swapped out.
  const actual = await importOriginal<typeof import('@gibs/utils/viem')>()
  return { ...actual, createChainClient: (chain: unknown) => createChainClient(chain as any) }
})

// Vitest cannot spy on fs's ESM named exports directly ("Module namespace is
// not configurable"), so writeFileSync is swapped out at the mock-factory
// level instead, keeping every other fs export (used by dotenv, readdir, etc.) real.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args) }
})

import { failureLog, failures } from '@gibs/utils'
import config from '../../config'
import { imageMode } from '../db/tables'
import * as path from 'path'
import * as paths from '../paths'
import {
  calculateHash,
  chainToPublicClient,
  commonNativeNames,
  counterId,
  directUri,
  findChain,
  folderContents,
  getFullChainId,
  mapToSet,
  printFailures,
  removedUndesirable,
  sortTokenEntry,
  terminal,
  terminalRow,
} from './index'
import * as viem from 'viem'

describe('printFailures', () => {
  beforeEach(() => {
    failures.length = 0
    writeFileSyncMock.mockReset()
  })

  it('writes accumulated failures to failures.json at the package root, coercing bigints to strings', () => {
    failureLog('erc20Read timed out', 12345678901234567890n)

    printFailures()

    expect(writeFileSyncMock).toHaveBeenCalledTimes(1)
    const [filePath, contents] = writeFileSyncMock.mock.calls[0]
    expect(filePath).toBe(path.join(paths.root, 'failures.json'))
    // JSON.stringify cannot serialize a bigint at all — without the replacer,
    // this call throws instead of writing anything.
    const parsed = JSON.parse(contents as string)
    expect(parsed).toEqual([['erc20Read timed out', '12345678901234567890']])
  })

  it('is best-effort: a write failure (e.g. a read-only CI filesystem) must not throw', () => {
    writeFileSyncMock.mockImplementation(() => {
      throw new Error('EROFS: read-only file system')
    })

    expect(() => printFailures()).not.toThrow()
  })
})

describe('getFullChainId', () => {
  it('left-pads the chain id to a 32-byte hex value', () => {
    expect(getFullChainId(369)).toBe('0x0000000000000000000000000000000000000000000000000000000000000171')
    expect(getFullChainId(0)).toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
  })
})

describe('calculateHash', () => {
  it('returns the sha256 hex digest of the buffer', () => {
    // Known SHA-256 test vector for "abc".
    expect(calculateHash(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('sortTokenEntry', () => {
  it('orders entries by address as a number, not lexically', () => {
    // Lexical order would put '0x9' before '0x10' wrongly; numeric compare must not.
    const low = { address: '0x0000000000000000000000000000000000000009' } as any
    const high = { address: '0x0000000000000000000000000000000000000010' } as any
    expect(sortTokenEntry(low, high)).toBe(-1)
    expect(sortTokenEntry(high, low)).toBe(1)
  })
})

describe('findChain', () => {
  const RPC_ENV_KEY = 'RPC_1'
  let original: string | undefined

  beforeEach(() => {
    original = process.env[RPC_ENV_KEY]
    Reflect.deleteProperty(process.env, RPC_ENV_KEY)
  })

  afterEach(() => {
    if (original === undefined) Reflect.deleteProperty(process.env, RPC_ENV_KEY)
    else process.env[RPC_ENV_KEY] = original
  })

  it('returns null for a chain id viem does not know', () => {
    // Not just any large number — 999_999_999 is Zora Sepolia's real chain id.
    expect(findChain(4_294_967_295)).toBeNull()
  })

  it('returns the plain viem chain when no RPC_<id> override is configured', () => {
    const chain = findChain(1)
    expect(chain?.id).toBe(1)
    expect(chain?.rpcUrls.default.http.length).toBeGreaterThan(0)
  })

  it('overrides the rpc urls (and strips load-balancer weights) from RPC_<id>, without mutating the shared viem chain', () => {
    process.env[RPC_ENV_KEY] = 'https://custom-a.example|3,https://custom-b.example'

    const chain = findChain(1)

    expect(chain?.rpcUrls.default.http).toEqual(['https://custom-a.example', 'https://custom-b.example'])
    // findChain must clone before mutating — otherwise this override would leak
    // into every other caller sharing viem's module-level mainnet object.
    const unaffected = findChain(1)
    Reflect.deleteProperty(process.env, RPC_ENV_KEY)
    const withoutOverride = findChain(1)
    expect(withoutOverride?.rpcUrls.default.http).not.toEqual(['https://custom-a.example', 'https://custom-b.example'])
    expect(unaffected).toBeDefined()
  })
})

describe('commonNativeNames', () => {
  it('recognizes the zero address and the conventional 0xeee... native placeholder', () => {
    expect(commonNativeNames.has(viem.zeroAddress)).toBe(true)
    expect(commonNativeNames.has(viem.getAddress('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'))).toBe(true)
  })

  it('does not treat an arbitrary address as native', () => {
    expect(commonNativeNames.has(viem.getAddress('0x1111111111111111111111111111111111111111'))).toBe(false)
  })
})

describe('removedUndesirable', () => {
  it('drops macOS .DS_Store entries and keeps everything else', () => {
    expect(removedUndesirable(['eip155-1', '.DS_Store', 'eip155-369'])).toEqual(['eip155-1', 'eip155-369'])
  })
})

describe('folderContents', () => {
  it('lists a folder with .DS_Store filtered out when no mapper is given', async () => {
    const readdirSpy = vi.spyOn(fs.promises, 'readdir').mockResolvedValue(['eip155-1', '.DS_Store'] as any)

    const result = await folderContents('/some/folder')

    expect(readdirSpy).toHaveBeenCalledWith('/some/folder')
    expect(result).toEqual(['eip155-1'])
    readdirSpy.mockRestore()
  })

  it('maps each remaining entry through the provided function, preserving order', async () => {
    const readdirSpy = vi.spyOn(fs.promises, 'readdir').mockResolvedValue(['b', '.DS_Store', 'a'] as any)

    const result = await folderContents('/some/folder', (entry) => entry.toUpperCase())

    expect(result).toEqual(['B', 'A'])
    readdirSpy.mockRestore()
  })
})

describe('directUri', () => {
  it('returns the raw uri verbatim for link-mode images', () => {
    expect(
      directUri({ mode: imageMode.LINK, uri: 'https://example.com/logo.png', imageHash: null, ext: null } as any),
    ).toBe('https://example.com/logo.png')
  })

  it('builds a direct-serve url from the hash and extension for saved images', () => {
    expect(directUri({ mode: imageMode.SAVE, uri: 'ignored', imageHash: 'abc123', ext: '.png' } as any)).toBe(
      `${config.rootURI}/image/direct/abc123.png`,
    )
  })

  it('returns undefined when a saved image is missing its hash or extension', () => {
    expect(directUri({ mode: imageMode.SAVE, uri: null, imageHash: null, ext: '.png' } as any)).toBeUndefined()
    expect(directUri({ mode: imageMode.SAVE, uri: null, imageHash: 'abc123', ext: null } as any)).toBeUndefined()
  })
})

describe('chainToPublicClient', () => {
  it('builds a client through @gibs/utils/viem and memoizes it per chain object', () => {
    createChainClient.mockClear()
    const chainA = { id: 1 } as any
    const chainB = { id: 369 } as any

    const first = chainToPublicClient(chainA)
    const second = chainToPublicClient(chainA)
    const third = chainToPublicClient(chainB)

    expect(second).toBe(first)
    expect(third).not.toBe(first)
    // A cache miss must still delegate to the real client factory — a
    // memoization bug that skipped the call would return `undefined` clients.
    expect(createChainClient).toHaveBeenCalledTimes(2)
  })
})

describe('terminalRow / terminal', () => {
  it('are created at module load', () => {
    expect(terminalRow).toBeDefined()
    expect(terminal).toBeDefined()
  })
})

describe('counterId', () => {
  it('network stringifies the id verbatim', () => {
    expect(counterId.network(369)).toBe('369')
    expect(counterId.network('eip155-369')).toBe('eip155-369')
  })

  it('token joins chainId and a lowercased address', () => {
    expect(counterId.token([369, '0xABCDEF'])).toBe('369-0xabcdef')
  })
})

describe('mapToSet', () => {
  it('network dedupes ids produced by the mapping function', () => {
    const list = [{ id: 1 }, { id: 1 }, { id: 2 }]
    const result = mapToSet.network(list, (v) => v.id)
    expect(result).toEqual(new Set(['1', '2']))
  })

  it('token dedupes chainId-address pairs produced by the mapping function', () => {
    const list = [
      { chainId: 369, address: '0xAAA' },
      { chainId: 369, address: '0xaaa' },
      { chainId: 1, address: '0xAAA' },
    ]
    const result = mapToSet.token(list, (v) => [v.chainId, v.address])
    expect(result).toEqual(new Set(['369-0xaaa', '1-0xaaa']))
  })
})
