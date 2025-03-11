import type { NextFunction, RequestHandler, Request, Response } from 'express'

export const nextOnError = (handler: RequestHandler) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      return await handler(req, res, next)
    } catch (err) {
      next(err)
    }
  }
}
