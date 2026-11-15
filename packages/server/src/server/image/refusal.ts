import type { Response } from 'express'

/** A refusal for load: the status, how long to wait, and the message the caller reads. */
export interface Refusal {
  status: number
  retryAfterSeconds: number
  message: string
}

/**
 * Answer a request that is refused for load, with `Retry-After`, and say so with `true` as the
 * request is handled. Written here, not thrown: the error funnel turns every 5xx into a generic 500.
 * Never cacheable, so an edge cache cannot keep a refusal and serve it after the load has passed.
 *
 * @param res The response to write.
 * @param refusal The status, the wait and the message.
 * @returns True, so a caller can return it as the answer.
 */
export function refuse(res: Response, { status, retryAfterSeconds, message }: Refusal): true {
  res.set('retry-after', String(retryAfterSeconds)).set('cache-control', 'no-store')
  res.status(status).json({ error: message })
  return true
}
