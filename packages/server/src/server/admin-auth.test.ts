/**
 * Tests for the admin bearer-token guard.
 *
 * Why these matter: PATCH /api/lists/submissions/:id approves submissions
 * into the collector pipeline. The guard must fail closed — no configured
 * token means nobody is authorized, not everybody.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

const mockConfig = vi.hoisted(() => ({ adminToken: undefined as string | undefined }))
vi.mock('../../config', () => ({ default: mockConfig }))

import { isAuthorizedAdmin, requireAdminToken } from './admin-auth'

describe('isAuthorizedAdmin', () => {
  it('fails closed when no admin token is configured, even with a header', () => {
    expect(isAuthorizedAdmin({ authorizationHeader: 'Bearer anything', adminToken: undefined })).toBe(false)
    expect(isAuthorizedAdmin({ authorizationHeader: 'Bearer anything', adminToken: '' })).toBe(false)
  })

  it('rejects a missing or malformed Authorization header', () => {
    expect(isAuthorizedAdmin({ authorizationHeader: undefined, adminToken: 'secret' })).toBe(false)
    expect(isAuthorizedAdmin({ authorizationHeader: 'secret', adminToken: 'secret' })).toBe(false)
    expect(isAuthorizedAdmin({ authorizationHeader: 'Basic secret', adminToken: 'secret' })).toBe(false)
  })

  it('rejects a mismatched token', () => {
    expect(isAuthorizedAdmin({ authorizationHeader: 'Bearer wrong', adminToken: 'secret' })).toBe(false)
    expect(isAuthorizedAdmin({ authorizationHeader: 'Bearer secre', adminToken: 'secret' })).toBe(false)
  })

  it('accepts the exact configured bearer token', () => {
    expect(isAuthorizedAdmin({ authorizationHeader: 'Bearer secret', adminToken: 'secret' })).toBe(true)
  })
})

describe('requireAdminToken middleware', () => {
  const mockResponse = () => {
    const res: Record<string, unknown> = {}
    res.status = vi.fn().mockReturnValue(res)
    res.json = vi.fn().mockReturnValue(res)
    return res
  }

  beforeEach(() => {
    mockConfig.adminToken = undefined
  })

  it('responds 401 unauthorized when ADMIN_TOKEN is unset, even with a header', () => {
    const res = mockResponse()
    const next = vi.fn()

    requireAdminToken(
      { headers: { authorization: 'Bearer anything' } } as unknown as Request,
      res as unknown as Response,
      next,
    )

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'unauthorized' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responds 401 unauthorized on token mismatch', () => {
    mockConfig.adminToken = 'secret'
    const res = mockResponse()
    const next = vi.fn()

    requireAdminToken(
      { headers: { authorization: 'Bearer wrong' } } as unknown as Request,
      res as unknown as Response,
      next,
    )

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next when the bearer token matches', () => {
    mockConfig.adminToken = 'secret'
    const res = mockResponse()
    const next = vi.fn()

    requireAdminToken(
      { headers: { authorization: 'Bearer secret' } } as unknown as Request,
      res as unknown as Response,
      next,
    )

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })
})
