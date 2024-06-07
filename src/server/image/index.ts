import { Router } from 'express'

export const router = Router()

// best guess
router.get('/:chainId/:address')

// list of providers, separated by "_"
router.get('/:chainId/:address/:providerSet')
