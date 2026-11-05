import { describe, it, expect } from 'vitest'
import { ipfs } from './ipfs'

describe('ipfs gateway defaults', () => {
  it('names gateways that answer servers, in order, and none of the ones that refuse them', () => {
    // ipfs.io answers every server request with HTTP 429 and cloudflare-ipfs.com is shut down.
    expect(ipfs().ipfs).toEqual(['https://ipfs.filebase.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/'])
  })
})
