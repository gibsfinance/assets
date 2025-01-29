import '../src/global.d.ts'
import './list.test'
import './server.test'
import './networks.test'

import { cleanup } from '../src/cleanup'
import test from 'node:test'

test.after(cleanup)
