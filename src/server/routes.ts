import { Router } from 'express'
import { router as imageRouter } from './image'
import { router as linkRouter } from './link'
import { router as listRouter } from './list'

export const router = Router()

// gib.show/image
router.use('/image', imageRouter)

// gib.show/link
router.use('/link', linkRouter)

// gib.show/list
router.use('/list', listRouter)
