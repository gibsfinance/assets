import { Router } from 'express'
import * as handlers from './handlers'
import * as sprite from './sprite'
import { nextOnError } from '../utils'

export const router = Router() as Router

// Sprite endpoints (before parameterized routes)
router.get('/sprite/:chainId/sheet', nextOnError(sprite.sheet))
router.get('/sprite/:chainId', nextOnError(sprite.manifest))

router.use('/direct/:imageHash', nextOnError(handlers.getImageByHash))
router.use('/fallback/:order/:chainId/:address', nextOnError(handlers.getImageAndFallback))
router.use('/:order/:chainId/:address', nextOnError(handlers.getImage(true)))
router.use('/:chainId/:address', nextOnError(handlers.getImage(false)))
// best guess routes
router.use('/:chainId', nextOnError(handlers.bestGuessNetworkImageFromOnOnChainInfo))
router.use('/', nextOnError(handlers.tryMultiple))
