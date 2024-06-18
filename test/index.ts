import '../src/global.d.ts'
import './basic.test'
import './list.test'
import './server.test'

import { cleanup } from '../src/cleanup'
import test from 'node:test'

test.after(cleanup)
