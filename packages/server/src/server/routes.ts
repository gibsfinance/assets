import { Router } from 'express'
import { router as imageRouter } from './image'
import { router as listRouter } from './list'
import { router as networksRouter } from './networks'
import { router as statsRouter } from './stats'

export const router = Router() as Router

router.use('/health', (_req, res) => {
  res.send('ok')
})

// gib.show/image
router.use('/image', imageRouter)

// gib.show/list
router.use('/list', listRouter)

router.use('/networks', networksRouter)

// gib.show/stats
router.use('/stats', statsRouter)
