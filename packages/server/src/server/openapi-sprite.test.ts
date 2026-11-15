import { describe, it, expect } from 'vitest'
import { openapi } from './openapi'

describe('sprite refusals in the OpenAPI definition', () => {
  const sheetResponses = openapi.paths['/sprite/{providerKey}/{listKey}/sheet'].get.responses

  it('documents the sheet budget refusal, 429, with a wait and no caching', () => {
    expect(sheetResponses['429'].description).toContain('sheet budget')
    expect(sheetResponses['429'].headers['Retry-After']).toBeDefined()
  })

  it('documents the busy refusal, 503, with a wait and no caching', () => {
    expect(sheetResponses['503'].description).toContain('drawn at once')
    expect(sheetResponses['503'].headers['Retry-After']).toBeDefined()
  })

  it('states the two lifetimes: a day when pinned, five minutes otherwise', () => {
    expect(sheetResponses['200'].description).toContain('a day when pinned by v')
    expect(openapi.paths['/sprite/{providerKey}/{listKey}'].get.responses['200'].description).toContain('five minutes')
  })
})
