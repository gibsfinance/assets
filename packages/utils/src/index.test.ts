import { describe, it, expect } from 'vitest'
import * as utils from './'

describe('index re-exports', () => {
  it('exports the module object', () => {
    expect(utils).toBeDefined()
    expect(typeof utils).toBe('object')
  })

  it('re-exports fetch utilities', () => {
    expect(typeof utils.limitBy).toBe('function')
    expect(typeof utils.limit).toBe('function')
    expect(typeof utils.retry).toBe('function')
    expect(typeof utils.cacheResult).toBe('function')
    expect(typeof utils.cancelAllRequests).toBe('function')
    expect(typeof utils.getLimiter).toBe('function')
    expect(typeof utils.limitByTime).toBe('function')
    expect(typeof utils.responseToBuffer).toBe('function')
    expect(typeof utils.urlToPossibleLocations).toBe('function')
    // iterativeIpfsCompatableFetch is exported as `fetch`
    expect(typeof utils.fetch).toBe('function')
  })

  it('re-exports log utilities', () => {
    expect(typeof utils.failureLog).toBe('function')
    expect(Array.isArray(utils.failures)).toBe(true)
  })

  it('re-exports timeout utility', () => {
    expect(typeof utils.timeout).toBe('function')
  })
})
