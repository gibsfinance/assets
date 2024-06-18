import { Router } from 'express'
import * as handlers from './handlers'

export const router = Router()

router.get('/merged/:order', handlers.merged)
router.get('/:providerKey/:listKey/:version', handlers.versioned)
router.get('/:providerKey/:listKey?', handlers.providerKeyed)
