/**
 * Guardrail tests for the attribution provider registry.
 *
 * Why: this list drives the "data sourced from" credits rendered in the UI.
 * A malformed entry (missing name, broken link, blank image) ships a broken
 * credit to users, and a duplicate name renders the same provider twice. These
 * structural invariants can't be caught by a type check, so they're pinned here.
 */
import { describe, it, expect } from 'vitest'
import { attributionProviders } from './attribution-providers'

describe('attributionProviders', () => {
  it('is a non-empty list', () => {
    expect(attributionProviders.length).toBeGreaterThan(0)
  })

  it('gives every provider a non-empty name, link, and imageUrl', () => {
    for (const provider of attributionProviders) {
      expect(provider.name.trim().length, `name for ${JSON.stringify(provider)}`).toBeGreaterThan(0)
      expect(provider.link.trim().length, `link for ${provider.name}`).toBeGreaterThan(0)
      expect(provider.imageUrl.trim().length, `imageUrl for ${provider.name}`).toBeGreaterThan(0)
    }
  })

  it('uses https links for every provider', () => {
    for (const provider of attributionProviders) {
      expect(provider.link, `link for ${provider.name}`).toMatch(/^https:\/\//)
    }
  })

  it('points every imageUrl at either an https URL or a local .svg/.png asset', () => {
    for (const provider of attributionProviders) {
      expect(provider.imageUrl, `imageUrl for ${provider.name}`).toMatch(/^(https:\/\/.+|.+\.(svg|png))$/)
    }
  })

  it('has no duplicate provider names', () => {
    const names = attributionProviders.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
