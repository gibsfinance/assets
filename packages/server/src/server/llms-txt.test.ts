/**
 * Tests for the /llms.txt body: the llmstxt.org shape, and that it actually
 * names the routes and query parameters an external caller needs — the whole
 * point of this file is to stop an undocumented surface from staying
 * undocumented, so the assertions check for the real route strings rather
 * than just "the string is non-empty".
 */
import { describe, it, expect } from 'vitest'
import { LLMS_TXT } from './llms-txt'

describe('LLMS_TXT', () => {
  it('opens with an H1 title and a blockquote summary, per the llmstxt.org convention', () => {
    const lines = LLMS_TXT.split('\n')
    expect(lines[0]).toBe('# Gib.Show')
    expect(lines[1]).toBe('')
    expect(lines[2].startsWith('> ')).toBe(true)
  })

  it('names every required route with an absolute https://gib.show URL', () => {
    const requiredUrls = [
      'https://gib.show/openapi.json',
      'https://gib.show/image/{chainId}',
      'https://gib.show/image/{chainId}/{address}',
      'https://gib.show/image/direct/{imageHash}',
      'https://gib.show/networks',
      'https://gib.show/list',
      'https://gib.show/list/search',
      'https://gib.show/stats',
      'https://gib.show/terms',
    ]
    for (const url of requiredUrls) {
      expect(LLMS_TXT, `missing ${url}`).toContain(url)
    }
  })

  it('names every required query parameter', () => {
    for (const param of ['`as`', '`w`', '`h`', '`only`', '`mode`']) {
      expect(LLMS_TXT, `missing ${param}`).toContain(param)
    }
  })

  it('states the true rate-limit position — no enforced limit, callers asked to be reasonable', () => {
    // The integrator this section answers held themselves to about forty
    // requests because nothing said what was acceptable. The one thing this
    // paragraph must never do is invent a number — say what is actually
    // true (nothing is enforced yet) rather than sound generous with a limit
    // nobody checks.
    expect(LLMS_TXT).toMatch(/no enforced request limit/i)
    expect(LLMS_TXT).toContain('https://gib.show/image/direct/{imageHash}')
  })

  it('links the three published guides under /skills/', () => {
    for (const guide of ['api-reference.md', 'list-management.md', 'self-hosting.md']) {
      expect(LLMS_TXT).toContain(`https://gib.show/skills/${guide}`)
    }
  })

  it('never uses a relative URL — every link is absolute', () => {
    const linkTargets = [...LLMS_TXT.matchAll(/\]\(([^)]+)\)/g)].map(([, target]) => target)
    expect(linkTargets.length).toBeGreaterThan(0)
    for (const target of linkTargets) {
      expect(target.startsWith('https://gib.show/'), `non-absolute link: ${target}`).toBe(true)
    }
  })
})
