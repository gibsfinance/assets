import assert from 'node:assert'
import test from 'node:test'
import config from '../config'

test('first', (t) => {
  t.test('adds', () => {
    assert.strictEqual(1, 1)
  })
})

test('config', (t) => {
  t.test('root uri', () => {
    assert.strictEqual(process.env.ROOT_URI, config.rootURI)
  })
})
