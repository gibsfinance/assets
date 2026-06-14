import '../src/global.d.ts'
import './list.test'
import './server.test'
import './networks.test'
import './db-batch.test'
import './list-token-upsert.test'
import './sync-order.test'
import './tokens-by-chain.test'
import './dedupe-migration.test'

import { cleanup } from '../src/cleanup'
import test from 'node:test'

test.after(cleanup)
