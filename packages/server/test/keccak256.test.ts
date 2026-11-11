/**
 * Holds the database's `keccak256(text)` (migration 0021, PL/pgSQL) to the function it
 * replaced (PL/Python with safe-pysha3, migration 0000 until then).
 *
 * Every primary key in the schema is this hash of its natural key, so a different output
 * for any input would orphan stored rows. Two kinds of proof:
 *   - fixed vectors, each one recorded from the PL/Python function itself, so they pin
 *     "same as before" and not merely "same as viem";
 *   - equality with viem's keccak256, which the application uses for the same ids, over
 *     every length from 0 to 300 bytes (all padding shapes around the 136-byte block)
 *     and over inputs shaped like the real trigger inputs.
 */
import { test } from 'node:test'
import assert from 'assert'
import * as viem from 'viem'
import { sql as dsql } from 'drizzle-orm'
import { getDrizzle } from '../src/db/drizzle'
import { toKeccakBytes } from '../src/utils'
import { isDbAvailable } from './db-available'

const skip = !(await isDbAvailable()) && 'no database connection'

/** Hash `input` with the database function. */
const hashInDatabase = async (input: string | null): Promise<string> => {
  const result = await getDrizzle().execute<{ hash: string }>(dsql`SELECT keccak256(${input}::text) AS hash`)
  return result.rows[0].hash
}

/** Outputs of the PL/Python implementation, captured before it was removed. */
const LEGACY_VECTORS: ReadonlyArray<readonly [label: string, input: string | null, hash: string]> = [
  ['empty string', '', 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
  ['null hashes as empty', null, 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
  ['short ascii', 'abc', '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
  [
    'sentence',
    'The quick brown fox jumps over the lazy dog',
    '4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15',
  ],
  [
    'unicode: accents, symbols, cjk, emoji',
    'héllo wörld ✓ 日本語 🚀',
    '0f58ddb51ad43ccb16edf6544bbe41f48a0dcafe8e12f58e31e9d29d5c7c6c20',
  ],
  ['135 bytes (one padding byte)', 'x'.repeat(135), '16570bdb055e663ea1cb57ac6f09194f4bc7b7070847971fc0b86710366dc34f'],
  [
    '136 bytes (a whole padding block)',
    'x'.repeat(136),
    '50da8ef3747b7a7f01d08563aa11c72a2a668563fb928adc6e8d2a1ab4e36096',
  ],
  ['137 bytes (second block)', 'x'.repeat(137), '01e0852c139fa337a5d3f746ab3b2d3400442195225e2f10c34702f8f37ae8d3'],
  ['300 bytes (three blocks)', 'a'.repeat(300), '5b7e0e47a96f32a88b4f14ca177982790807c40e1a105742ba0fc1babe1ef826'],
]

for (const [label, input, hash] of LEGACY_VECTORS) {
  test(`keccak256 matches the PL/Python output: ${label}`, { skip }, async () => {
    assert.strictEqual(await hashInDatabase(input), hash)
  })
}

test('keccak256 equals viem for every length from 0 to 300 bytes', { skip }, async () => {
  const mismatches: number[] = []
  for (let length = 0; length <= 300; length++) {
    const input = String.fromCharCode(...Array.from({ length }, (_, index) => 33 + ((index * 7 + length) % 90)))
    if ((await hashInDatabase(input)) !== toKeccakBytes(input)) mismatches.push(length)
  }
  assert.deepStrictEqual(mismatches, [])
})

test('keccak256 equals viem for multi-byte text and trigger-shaped inputs', { skip }, async () => {
  const address = '0x' + 'ab'.repeat(20)
  const providerId = viem.keccak256(viem.toBytes('trustwallet')).slice(2)
  const inputs = [
    'é'.repeat(100), // two bytes per character, crossing a block boundary
    '日本語'.repeat(60), // three bytes per character
    '🚀'.repeat(40), // four bytes per character
    `evm1`, // network_id input: type then chain id
    `${providerId}trustwallet100`, // list_id input: provider, key, major, minor, patch
    `${toKeccakBytes('evm1')}${address}`, // token_id input: network id then provided id
    `${toKeccakBytes(`${providerId}${address}`)}${toKeccakBytes('list')}`, // list_token_id input
  ]
  for (const input of inputs) {
    assert.strictEqual(await hashInDatabase(input), toKeccakBytes(input), input.slice(0, 24))
  }
})

test('the database no longer needs plpython3u', { skip }, async () => {
  const result = await getDrizzle().execute<{ language: string }>(
    dsql`SELECT l.lanname AS language FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.proname = 'keccak256'`,
  )
  assert.deepStrictEqual(
    result.rows.map((row) => row.language),
    ['plpgsql'],
  )
})
