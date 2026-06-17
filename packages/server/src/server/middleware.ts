/**
 * @module middleware
 * App-level middleware shared between the express app (app.ts) and tests.
 */
import type express from 'express'
import createError, { HttpError } from 'http-errors'

/**
 * JSON body-parser limit applied app-wide in app.ts.
 *
 * Must comfortably exceed the 512 KB decoded image limit enforced by
 * POST /api/images/submit — base64 inflates payloads by ~4/3, plus JSON
 * envelope overhead — so the route's own 400 contract stays reachable.
 */
export const JSON_BODY_LIMIT = '1mb'

/**
 * True when the error is an intentional client error created via http-errors
 * (a 4xx with expose=true). This covers handler-thrown errors such as
 * `httpErrors.NotFound('image not found')` as well as body-parser errors
 * (413 payload-too-large, 400 malformed JSON).
 */
const isExpectedClientError = (err: unknown): err is HttpError =>
  createError.isHttpError(err) && err.expose && err.status < 500

/**
 * Final error funnel for the express app.
 *
 * Intentional client errors keep their message. Everything else — database
 * failures, programmer errors, anything not created via http-errors — is
 * logged server-side and returned as a generic 500 so internals (for example
 * raw SQL text and parameters from Drizzle errors) never reach clients.
 */
export const errorMiddleware = (
  err: unknown,
  _req: express.Request,
  res: express.Response,
  // the 4-argument signature is required for express to register an error handler

  _next: express.NextFunction,
) => {
  if (isExpectedClientError(err)) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'internal server error' })
}
