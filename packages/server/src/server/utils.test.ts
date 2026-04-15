import { describe, it, expect, vi } from 'vitest'
import { nextOnError } from './utils'

describe('nextOnError', () => {
  it('calls the handler and returns its result', async () => {
    const handler = vi.fn().mockResolvedValue('ok')
    const wrapped = nextOnError(handler)
    const req = {} as any
    const res = {} as any
    const next = vi.fn()
    await wrapped(req, res, next)
    expect(handler).toHaveBeenCalledWith(req, res, next)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next with error when handler throws', async () => {
    const error = new Error('boom')
    const handler = vi.fn().mockRejectedValue(error)
    const wrapped = nextOnError(handler)
    const req = {} as any
    const res = {} as any
    const next = vi.fn()
    await wrapped(req, res, next)
    expect(next).toHaveBeenCalledWith(error)
  })
})
