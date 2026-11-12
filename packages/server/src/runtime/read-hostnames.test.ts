import { describe, expect, it } from 'vitest'
import { readHostnames } from './read-hostnames'

describe('readHostnames', () => {
  it('splits on commas, trims spaces and lower-cases each name', () => {
    expect(readHostnames('Docs.Example.test, docs-staging.example.test ,other.test')).toEqual([
      'docs.example.test',
      'docs-staging.example.test',
      'other.test',
    ])
  })

  it('ignores empty entries', () => {
    expect(readHostnames(',a.test,, ,b.test,')).toEqual(['a.test', 'b.test'])
  })

  it.each([undefined, '', '   ', ','])('gives an empty list for %j, which leaves the feature off', (rawValue) => {
    expect(readHostnames(rawValue)).toEqual([])
  })
})
