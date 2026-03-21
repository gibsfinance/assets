import { describe, it, expect } from 'vitest'
import { createClient } from './client'

describe('createClient', () => {
  it('defaults to production URL', () => {
    const client = createClient()
    expect(client.baseUrl).toBe('https://gib.show')
  })

  it('uses staging URL when staging: true', () => {
    const client = createClient({ staging: true })
    expect(client.baseUrl).toBe('https://staging.gib.show')
  })

  it('uses custom baseUrl', () => {
    const client = createClient({ baseUrl: 'http://localhost:3000' })
    expect(client.baseUrl).toBe('http://localhost:3000')
  })

  it('builds image URLs via client', () => {
    const client = createClient()
    const url = client.imageUrl(1, '0xabc', { width: 72, format: 'webp' })
    expect(url).toContain('https://gib.show/image/1/0xabc')
    expect(url).toContain('w=72')
    expect(url).toContain('format=webp')
  })

  it('builds network image URLs via client', () => {
    const client = createClient({ staging: true })
    expect(client.networkImageUrl(369)).toBe('https://staging.gib.show/image/369')
  })
})
