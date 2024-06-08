import { Router, type Response } from 'express'
import * as viem from 'viem'
import * as utils from '@/utils'
import * as db from '@/db'
import { tableNames } from '@/db/tables'
import httpErrors from 'http-errors'
import { ChainId } from '@/types'
import config from 'config'
import { Image, ListToken } from 'knex/types/tables'

export const router = Router()

const getListTokens = async (chainId: ChainId, address: viem.Hex) => {
  const filter = {
    networkId: utils.chainIdToNetworkId(chainId),
    providedId: viem.getAddress(address),
  }
  return {
    filter,
    img: await db.getDB().select<ListToken & Image>('*')
      .from(tableNames.listToken)
      .join(`${config.database.schema}.${tableNames.image}`, {
        [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash`,
      })
      .where(filter)
      .first(),
  }
}

// best guess
router.use('/:chainId/:address', async (req, res, next) => {
  const { chainId, address } = req.params
  if (!+chainId) {
    return next(httpErrors.BadRequest('chainId'))
  }
  if (!viem.isAddress(address)) {
    return next(httpErrors.BadRequest('address'))
  }
  const { filter, img } = await getListTokens(+chainId, address)
  if (!img) {
    return next(httpErrors.NotFound())
  }
  sendImage(res, img)
})

const sendImage = (res: Response, img: Image) => {
  res.contentType(img.ext).send(img.content)
}

// list of providers, separated by "_"
// router.get('/:chainId/:address/:providerSet')
