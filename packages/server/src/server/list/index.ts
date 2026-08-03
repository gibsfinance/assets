import { Router } from 'express'
import * as handlers from './handlers'
import { nextOnError } from '../utils'

export const router = Router() as Router

router.get('/merged/:order', nextOnError(handlers.merged))
router.get('/tokens/:chainId', nextOnError(handlers.tokensByChain))
// Ahead of the `/:providerKey` catch-all below, which is a single path segment and would
// otherwise swallow this as a request for a provider named "search". That reserves the
// name, the same way "merged" and "tokens" are already reserved. Nothing can take it:
// collector provider keys are literals in the collect/ modules, and a submitted list is
// keyed `user-${slugify(submittedBy)}` (server/submissions.ts), so the one path that
// accepts a name from outside cannot produce an unprefixed one.
router.get('/search', nextOnError(handlers.search))
router.get('/:providerKey/:listKey/:version', nextOnError(handlers.versioned))
router.get('/:providerKey{/:listKey}', nextOnError(handlers.providerKeyed))
router.get('/', nextOnError(handlers.all))
