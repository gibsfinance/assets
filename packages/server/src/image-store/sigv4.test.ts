import { describe, expect, it } from 'vitest'
import { EMPTY_PAYLOAD_SHA256, encodeRfc3986, signRequestV4, type AwsCredentials } from './sigv4'
import { hashBytes } from './hash'

/** The example credentials AWS prints throughout its Signature Version 4 documentation. */
const CREDENTIALS: AwsCredentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}
const DATE = new Date(Date.UTC(2013, 4, 24))

/** The part of `authorization` after `Signature=`. */
const signatureOf = (headers: Record<string, string>): string => headers.authorization.split('Signature=')[1]

describe('signRequestV4, against the examples in the Amazon S3 documentation ("Signature Calculations for the Authorization Header")', () => {
  it('signs GET Object with a Range header', () => {
    const headers = signRequestV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { Range: 'bytes=0-9' },
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      region: 'us-east-1',
      credentials: CREDENTIALS,
      date: DATE,
    })

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
    expect(headers['x-amz-date']).toBe('20130524T000000Z')
    expect(headers['x-amz-content-sha256']).toBe(EMPTY_PAYLOAD_SHA256)
    expect(headers.range).toBe('bytes=0-9')
    expect(headers).not.toHaveProperty('host')
  })

  it('signs PUT Object, with an encoded dollar sign in the path and extra signed headers', () => {
    const body = Buffer.from('Welcome to Amazon S3.')

    const headers = signRequestV4({
      method: 'PUT',
      url: new URL('https://examplebucket.s3.amazonaws.com/test%24file.text'),
      headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      payloadSha256: hashBytes(body),
      region: 'us-east-1',
      credentials: CREDENTIALS,
      date: DATE,
    })

    expect(headers.authorization).toContain(
      'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class',
    )
    expect(signatureOf(headers)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd')
  })

  it('signs a subresource query that has a name and no value', () => {
    const headers = signRequestV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/?lifecycle'),
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      region: 'us-east-1',
      credentials: CREDENTIALS,
      date: DATE,
    })

    expect(signatureOf(headers)).toBe('fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543')
  })

  it('signs a listing with a query of two parameters, sorted by name', () => {
    const headers = signRequestV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2'),
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      region: 'us-east-1',
      credentials: CREDENTIALS,
      date: DATE,
    })

    expect(signatureOf(headers)).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7')
  })
})

describe('signRequestV4, beyond the published examples', () => {
  const base = {
    method: 'GET',
    url: new URL('https://storage.example.test/bucket/key'),
    payloadSha256: EMPTY_PAYLOAD_SHA256,
    region: 'auto',
    credentials: CREDENTIALS,
    date: DATE,
  }

  it('signs and sends the security token of temporary credentials', () => {
    const headers = signRequestV4({ ...base, credentials: { ...CREDENTIALS, sessionToken: 'token value' } })

    expect(headers['x-amz-security-token']).toBe('token value')
    expect(headers.authorization).toContain('x-amz-security-token')
  })

  it('gives a different signature for a different region, service, secret, date and path', () => {
    const signatures = [
      signRequestV4(base),
      signRequestV4({ ...base, region: 'eu-west-1' }),
      signRequestV4({ ...base, service: 'other' }),
      signRequestV4({ ...base, credentials: { ...CREDENTIALS, secretAccessKey: 'another secret' } }),
      signRequestV4({ ...base, date: new Date(Date.UTC(2013, 4, 25)) }),
      signRequestV4({ ...base, url: new URL('https://storage.example.test/bucket/other') }),
    ].map(signatureOf)

    expect(new Set(signatures).size).toBe(signatures.length)
  })

  it('sorts a query by name and then by value, and collapses spaces in header values', () => {
    const first = signRequestV4({
      ...base,
      url: new URL('https://storage.example.test/?a=2&a=1&a-b=1&B=1'),
      headers: { 'x-custom': '  two   spaces ' },
    })
    const second = signRequestV4({
      ...base,
      url: new URL('https://storage.example.test/?B=1&a-b=1&a=1&a=2'),
      headers: { 'x-custom': 'two spaces' },
    })

    expect(signatureOf(first)).toBe(signatureOf(second))
  })

  it('does not let a caller override the signed date or payload hash', () => {
    const headers = signRequestV4({
      ...base,
      headers: { 'X-Amz-Date': 'bogus', 'x-amz-content-sha256': 'bogus' },
    })

    expect(headers['x-amz-date']).toBe('20130524T000000Z')
    expect(headers['x-amz-content-sha256']).toBe(EMPTY_PAYLOAD_SHA256)
  })
})

describe('encodeRfc3986', () => {
  it('leaves unreserved characters alone and encodes the rest, including the ones encodeURIComponent keeps', () => {
    expect(encodeRfc3986('azAZ09-_.~')).toBe('azAZ09-_.~')
    expect(encodeRfc3986("a b/c!'()*")).toBe('a%20b%2Fc%21%27%28%29%2A')
  })
})
