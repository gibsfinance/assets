import './image-store-directory'
import '../src/global.d.ts'
import './list.test'
import './server.test'
import './non-evm-image.test'
import './networks.test'
import './db-batch.test'
import './list-token-upsert.test'
import './tokens-by-chain.test'
import './dedupe-migration.test'
import './sprite-chain-filter.test'
import './canonical-image.test'
import './algorand-alias-migration.test'
import './keccak256.test'
import './image-store.test'
import './source-tokens.test'

import { cleanup } from '../src/cleanup'
import { removeImageStoreRoot } from './image-store-directory'
import test from 'node:test'

test.after(async () => {
  await cleanup()
  removeImageStoreRoot()
})
