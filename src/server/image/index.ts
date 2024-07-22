import { Router } from 'express'
import * as handlers from './handlers'

export const router = Router()

router.use('/direct/:imageHash', handlers.getImageByHash)
router.use('/fallback/:order/:chainId/:address', handlers.getImageAndFallback)
router.use('/:order/:chainId/:address', handlers.getImage(true))
router.use('/:chainId/:address', handlers.getImage(false))
// best guess
router.use('/:chainId', handlers.bestGuessNetworkImageFromOnOnChainInfo)
router.use('/', handlers.tryMultiple)
