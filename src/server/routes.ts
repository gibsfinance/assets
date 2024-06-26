import { Router } from 'express'
import { router as imageRouter } from './image'
import { router as listRouter } from './list'

export const router = Router()

router.use('/health', (_req, res) => {
  res.send('ok')
})

// gib.show/image
router.use('/image', imageRouter)

// gib.show/list
router.use('/list', listRouter)
