import { describe, it, expect, vi, afterEach } from 'vitest'
import * as path from 'node:path'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('submodules', () => {
  it('is the submodules directory at the repository root by default', async () => {
    vi.stubEnv('SUBMODULES_DIRECTORY', '')
    vi.resetModules()
    const paths = await import('./paths')

    expect(paths.submodules).toBe(path.join(paths.root, '..', '..', 'submodules'))
  })

  it('moves to SUBMODULES_DIRECTORY, resolved to an absolute path, when it is set', async () => {
    vi.stubEnv('SUBMODULES_DIRECTORY', '/mnt/artwork')
    vi.resetModules()
    const paths = await import('./paths')

    expect(paths.submodules).toBe('/mnt/artwork')
  })
})
