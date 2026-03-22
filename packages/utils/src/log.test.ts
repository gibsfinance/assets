import { describe, it, expect, beforeEach } from 'vitest'
import { failureLog, failures } from './log'

describe('failureLog', () => {
  beforeEach(() => {
    failures.length = 0
  })

  it('accumulates failure messages', () => {
    failureLog('error 1')
    failureLog('error 2', { detail: 'info' })
    expect(failures).toHaveLength(2)
    expect(failures[0]).toEqual(['error 1'])
    expect(failures[1]).toEqual(['error 2', { detail: 'info' }])
  })

  it('starts with empty array', () => {
    expect(failures).toHaveLength(0)
  })
})
