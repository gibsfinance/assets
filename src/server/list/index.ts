import { Router } from 'express'
import createError from 'http-errors'
import * as data from '@/server/data'
import { request } from 'http'

export const router = Router()

router.get('/all', async (_req, res, _next) => {
  res.json(data.allTokenLists)
})

router.get('/:providerKey', async (req, res, next) => {
  const listLink = data.providerToListLink().get(req.params.providerKey)
  if (!listLink) {
    return next(createError.NotFound())
  }
  req.pipe(request(listLink)).pipe(res)
})
