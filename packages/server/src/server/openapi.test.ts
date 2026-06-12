/**
 * Structural invariants of the OpenAPI definition.
 *
 * Why these matter: the docs page renders entirely from this document —
 * sections come from tags, cards from operations, live probes from
 * x-example. An operation with a missing tag silently vanishes from the
 * page; an x-example that drifts from its path template probes the wrong
 * endpoint; an undeclared tag breaks section ordering.
 */
import { describe, it, expect } from 'vitest'
import { openapi } from './openapi'

type Operation = {
  tags?: readonly string[]
  summary?: string
  'x-example'?: string
  responses?: Record<string, unknown>
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

const operations: { path: string; method: string; op: Operation }[] = []
for (const [path, methods] of Object.entries(openapi.paths)) {
  for (const method of METHODS) {
    const op = (methods as Record<string, Operation>)[method]
    if (op) operations.push({ path, method, op })
  }
}

describe('openapi document', () => {
  it('declares OpenAPI 3.1 with title and version', () => {
    expect(openapi.openapi).toBe('3.1.0')
    expect(openapi.info.title).toBeTruthy()
    expect(openapi.info.version).toBeTruthy()
  })

  it('has at least the known public surface', () => {
    expect(operations.length).toBeGreaterThanOrEqual(18)
  })

  it('tags every operation, and only with declared tags (sections derive from them)', () => {
    const declared = new Set<string>(openapi.tags.map((t) => t.name))
    for (const { path, method, op } of operations) {
      expect(op.tags?.length, `${method.toUpperCase()} ${path} has no tags`).toBeGreaterThan(0)
      for (const tag of op.tags!) {
        expect(declared.has(tag), `${method.toUpperCase()} ${path} uses undeclared tag "${tag}"`).toBe(true)
      }
    }
  })

  it('gives every operation a summary (the card description)', () => {
    for (const { path, method, op } of operations) {
      expect(op.summary, `${method.toUpperCase()} ${path} has no summary`).toBeTruthy()
    }
  })

  it('gives every GET operation an x-example the docs page can probe', () => {
    for (const { path, method, op } of operations) {
      if (method !== 'get') continue
      expect(op['x-example'], `GET ${path} has no x-example`).toBeTruthy()
    }
  })

  it('keeps each x-example consistent with its path template', () => {
    for (const { path, method, op } of operations) {
      const example = op['x-example']
      if (!example) continue
      const examplePath = example.split('?')[0]
      const staticPrefix = path.slice(0, path.indexOf('{') === -1 ? path.length : path.indexOf('{'))
      expect(
        examplePath.startsWith(staticPrefix),
        `${method.toUpperCase()} ${path}: x-example "${example}" does not start with "${staticPrefix}"`,
      ).toBe(true)
      expect(
        examplePath.split('/').length,
        `${method.toUpperCase()} ${path}: x-example "${example}" has the wrong segment count`,
      ).toBe(path.split('/').length)
    }
  })

  it('uses prefixed chain identifiers in examples, never bare numerics', () => {
    for (const { path, op } of operations) {
      const example = op['x-example']
      if (!example) continue
      // A path segment that is purely numeric would be a bare chain id
      const segments = example.split('?')[0].split('/').filter(Boolean)
      for (const segment of segments) {
        expect(
          /^\d+$/.test(segment),
          `${path}: x-example segment "${segment}" is a bare numeric chain id — use the eip155- prefix`,
        ).toBe(false)
      }
    }
  })

  it('resolves every $ref to a declared component schema', () => {
    const declared = new Set(Object.keys(openapi.components.schemas))
    const refs = JSON.stringify(openapi).match(/"#\/components\/schemas\/([A-Za-z]+)"/g) ?? []
    for (const ref of refs) {
      const name = ref.slice('"#/components/schemas/'.length, -1)
      expect(declared.has(name), `$ref to undeclared schema "${name}"`).toBe(true)
    }
  })

  it('gives every operation at least one response', () => {
    for (const { path, method, op } of operations) {
      expect(
        Object.keys(op.responses ?? {}).length,
        `${method.toUpperCase()} ${path} has no responses`,
      ).toBeGreaterThan(0)
    }
  })
})
