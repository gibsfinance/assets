import { describe, expect, it } from 'vitest'
import { assertSha256Hex, hashBytes, isSha256Hex } from './hash'

const HELLO_DIGEST = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

describe('hashBytes', () => {
  it('returns the published sha256 of known content', () => {
    expect(hashBytes(Buffer.from('hello'))).toBe(HELLO_DIGEST)
    // The digest of nothing at all is as well known as any.
    expect(hashBytes(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes bytes, not the text a view of them would print as', () => {
    expect(hashBytes(new Uint8Array([0xff, 0x00, 0x80]))).not.toBe(hashBytes(Buffer.from('ff0080')))
    expect(hashBytes(new Uint8Array([104, 101, 108, 108, 111]))).toBe(HELLO_DIGEST)
  })
})

describe('isSha256Hex and assertSha256Hex', () => {
  it('accepts exactly 64 lowercase hexadecimal characters', () => {
    expect(isSha256Hex(HELLO_DIGEST)).toBe(true)
    expect(assertSha256Hex(HELLO_DIGEST)).toBe(HELLO_DIGEST)
  })

  it.each([
    undefined,
    null,
    42,
    {},
    '',
    '../x',
    HELLO_DIGEST.toUpperCase(),
    HELLO_DIGEST.slice(2),
    `${HELLO_DIGEST}ab`,
    `${HELLO_DIGEST}\n`,
    `x${HELLO_DIGEST.slice(1)}`,
  ])('refuses %j', (candidate) => {
    expect(isSha256Hex(candidate)).toBe(false)
    expect(() => assertSha256Hex(candidate)).toThrow(TypeError)
  })
})
