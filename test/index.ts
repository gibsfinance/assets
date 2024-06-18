import './basic.test'
import './list.test'

import { cleanup } from '../src/cleanup'
import test from 'node:test'

test.after(cleanup)
