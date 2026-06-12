/**
 * @module admin-auth
 * Bearer-token guard for admin-only endpoints (submission moderation and the
 * approved-submissions feed). The token comes from the ADMIN_TOKEN environment
 * variable via config; when unset the guard fails closed.
 */
import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import config from '../../config'

/** Constant-time string comparison to avoid leaking the token via timing. */
const constantTimeEquals = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

/**
 * Pure check: does the Authorization header carry the configured admin token?
 * Fails closed — when no admin token is configured, nothing is authorized.
 */
export const isAuthorizedAdmin = (options: { authorizationHeader?: string; adminToken?: string }): boolean => {
  const { authorizationHeader, adminToken } = options
  if (!adminToken) return false
  if (!authorizationHeader?.startsWith('Bearer ')) return false
  return constantTimeEquals(authorizationHeader.slice('Bearer '.length), adminToken)
}

/**
 * Express middleware requiring the admin bearer token.
 * Responds 401 `{ error: 'unauthorized' }` when the token is unset or mismatched.
 */
export const requireAdminToken = (req: Request, res: Response, next: NextFunction) => {
  const authorized = isAuthorizedAdmin({
    authorizationHeader: req.headers.authorization,
    adminToken: config.adminToken,
  })
  if (!authorized) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  next()
}
