import { Router } from 'express'
import * as handlers from './handlers'
import { nextOnError } from '../utils'

export const router = Router() as Router

router.use('/direct/:imageHash', nextOnError(handlers.getImageByHash))
router.use('/fallback/:order/:chainId/:address', nextOnError(handlers.getImageAndFallback))
router.use('/:order/:chainId/:address', nextOnError(handlers.getImage(true)))
router.use('/:chainId/:address', nextOnError(handlers.getImage(false)))
// best guess
router.use('/:chainId', nextOnError(handlers.bestGuessNetworkImageFromOnOnChainInfo))
router.use('/', nextOnError(handlers.tryMultiple))
