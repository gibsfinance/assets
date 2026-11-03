import { describe, it, expect, vi } from 'vitest'
import { registerServiceWorker, type RegistrationEnvironment } from './register'

const environment = (overrides: {
  enabled?: boolean
  serviceWorker?: boolean
  readyState?: string
  register?: () => Promise<unknown>
}) => {
  const register = vi.fn(overrides.register ?? (() => Promise.resolve({})))
  const listeners: Array<() => void> = []
  const env: RegistrationEnvironment = {
    enabled: overrides.enabled ?? true,
    navigator: overrides.serviceWorker === false ? {} : { serviceWorker: { register } },
    window: {
      addEventListener: (_type, listener) => listeners.push(listener),
      document: { readyState: overrides.readyState ?? 'loading' },
    },
  }
  return { env, register, listeners }
}

describe('registerServiceWorker', () => {
  it('waits for the load event, then registers /sw.js at the site root', () => {
    const { env, register, listeners } = environment({})
    registerServiceWorker(env)
    expect(register).not.toHaveBeenCalled()
    listeners[0]()
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })

  it('registers at once when the page has already loaded', () => {
    const { env, register, listeners } = environment({ readyState: 'complete' })
    registerServiceWorker(env)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
    expect(listeners).toEqual([])
  })

  it('does nothing when switched off, as in development and tests', () => {
    const { env, register, listeners } = environment({ enabled: false, readyState: 'complete' })
    registerServiceWorker(env)
    expect(register).not.toHaveBeenCalled()
    expect(listeners).toEqual([])
  })

  it('does nothing where the browser has no service worker support', () => {
    const { env, listeners } = environment({ serviceWorker: false })
    registerServiceWorker(env)
    expect(listeners).toEqual([])
  })

  it('ignores a failed registration', async () => {
    const { env, register } = environment({ readyState: 'complete', register: () => Promise.reject(new Error('no')) })
    registerServiceWorker(env)
    await Promise.resolve()
    expect(register).toHaveBeenCalled()
  })
})
