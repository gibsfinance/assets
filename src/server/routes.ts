import { Router } from 'express'
import { router as imageRouter } from './image'
import { router as linkRouter } from './link'
import { router as listRouter } from './list'

export const router = Router()

// gib.show/image
router.get('/image', imageRouter)

// gib.show/link
router.get('/link', linkRouter)

// gib.show/list
router.get('/list', listRouter)
