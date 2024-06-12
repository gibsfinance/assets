import assert from 'node:assert'
import test from 'node:test'

test('first', (t) => {
  t.test('adds', () => {
    assert.strictEqual(1, 1)
  })
})
