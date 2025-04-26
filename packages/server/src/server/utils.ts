import type { NextFunction, RequestHandler, Request, Response } from 'express'

export const nextOnError = <Params, Body, ResBody, ReqQuery>(
  handler: RequestHandler<Params, Body, ResBody, ReqQuery>,
) => {
  return async (req: Request<Params, Body, ResBody, ReqQuery>, res: Response, next: NextFunction) => {
    try {
      return await handler(req, res, next)
    } catch (err) {
      next(err)
    }
  }
}
