import { Router } from 'express'
import * as handlers from './handlers'
import { nextOnError } from '../utils'

export const router = Router() as Router

router.get('/merged/:order', nextOnError(handlers.merged))
router.get('/:providerKey/:listKey/:version', nextOnError(handlers.versioned))
router.get('/:providerKey/:listKey?', nextOnError(handlers.providerKeyed))
router.get('/bridge/:providerKey/:listKey?', nextOnError(handlers.providerKeyed))
router.get('/', nextOnError(handlers.all))
