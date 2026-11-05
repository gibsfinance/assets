import { describe, expect, it } from 'vitest'
import { describeBrowserEndpoint } from './browser-endpoint'

describe('describeBrowserEndpoint', () => {
  it('drops the token so it never reaches a log', () => {
    const described = describeBrowserEndpoint('ws://browser-production:3000?token=7dea38secretvalue')
    expect(described).toBe('ws://browser-production:3000/')
    expect(described).not.toContain('7dea38')
  })

  it('drops user information and keeps the path', () => {
    const described = describeBrowserEndpoint('wss://user:hunter2@browser.example:443/chromium?token=abc&x=1')
    expect(described).toBe('wss://browser.example/chromium')
    expect(described).not.toContain('hunter2')
    expect(described).not.toContain('abc')
  })

  it('never echoes a value that is not a URL', () => {
    expect(describeBrowserEndpoint('not a url token=abc')).toBe('<unparseable endpoint>')
  })
})
