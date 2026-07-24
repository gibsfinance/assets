import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `logger.ts` seeds `process.env.DEBUG` at import time, so each case has to
 * load a fresh copy of the module with the environment already arranged.
 */
const loadLogger = async () => {
  vi.resetModules()
  return import('./logger')
}

describe('logger', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env.DEBUG
  })

  afterEach(() => {
    if (original === undefined) {
      Reflect.deleteProperty(process.env, 'DEBUG')
      return
    }
    process.env.DEBUG = original
  })

  it('enables its own namespace when no debug filter is configured', async () => {
    Reflect.deleteProperty(process.env, 'DEBUG')

    const { log } = await loadLogger()

    expect(process.env.DEBUG).toBe('📷*')
    expect(log.namespace).toBe('📷')
  })

  it('leaves an operator-supplied debug filter alone', async () => {
    // Overwriting this would silently discard a filter the operator set to
    // narrow noisy output — the default is a fallback, not a policy.
    process.env.DEBUG = 'someothernamespace:*'

    await loadLogger()

    expect(process.env.DEBUG).toBe('someothernamespace:*')
  })
})
