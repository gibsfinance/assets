import { Router } from 'express'
import * as handlers from './handlers'

export const router = Router()

router.use(`/direct/:imageHash`, handlers.getImageByHash)
router.use(`/:order/:chainId/:address`, handlers.getImage)
// best guess
router.use('/:chainId', handlers.bestGuessNetworkImageFromOnOnChainInfo)
