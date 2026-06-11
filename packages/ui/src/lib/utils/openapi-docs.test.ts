/**
 * The docs page renders entirely from these transforms — if grouping, ordering,
 * or example resolution drifts, sections vanish or probe the wrong URLs.
 */
import { describe, it, expect } from 'vitest'
import { specToSections, sectionIdForTag, type OpenApiDocument } from './openapi-docs'

const spec: OpenApiDocument = {
  openapi: '3.1.0',
  info: { title: 'Test API', version: '1.0.0' },
  tags: [
    { name: 'Token Endpoints', description: 'Lists.' },
    { name: 'Networks & Stats' },
    { name: 'Empty Section' },
  ],
  paths: {
    '/list/tokens/{chainId}': {
      get: {
        tags: ['Token Endpoints'],
        summary: 'Ranked tokens',
        'x-example': '/list/tokens/eip155-369?limit=20',
      },
    },
    '/stats': {
      get: { tags: ['Networks & Stats'], summary: 'Counts', 'x-example': '/stats' },
    },
    '/list/submit': {
      post: { tags: ['Token Endpoints'], summary: 'Submit a list' },
    },
    '/untagged': {
      get: { summary: 'Not shown anywhere' },
    },
  },
}

describe('sectionIdForTag', () => {
  it('slugifies tag names into stable anchor ids', () => {
    expect(sectionIdForTag('Token Endpoints')).toBe('token-endpoints')
    expect(sectionIdForTag('Networks & Stats')).toBe('networks-stats')
  })
})

describe('specToSections', () => {
  const sections = specToSections(spec, 'https://gib.show')

  it('creates one section per declared tag, in declaration order, dropping empty ones', () => {
    expect(sections.map((s) => s.id)).toEqual(['token-endpoints', 'networks-stats'])
    expect(sections[0].label).toBe('Token Endpoints')
    expect(sections[0].description).toBe('Lists.')
  })

  it('maps operations to cards with uppercased method and summary as description', () => {
    const tokens = sections[0].endpoints
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({ method: 'GET', path: '/list/tokens/{chainId}', description: 'Ranked tokens' })
    expect(tokens[1]).toMatchObject({ method: 'POST', path: '/list/submit' })
  })

  it('resolves x-example against the api base, and omits example when absent', () => {
    expect(sections[0].endpoints[0].example).toBe('https://gib.show/list/tokens/eip155-369?limit=20')
    expect(sections[0].endpoints[1].example).toBeUndefined()
  })

  it('drops operations with no tags rather than inventing a section', () => {
    const allPaths = sections.flatMap((s) => s.endpoints.map((e) => e.path))
    expect(allPaths).not.toContain('/untagged')
  })
})
