/**
 * Guardrail tests for the table-name and image-mode registries.
 *
 * Why: tableNames is the single source of truth that the Drizzle schema, query
 * builders, and migrations all key off. A duplicate physical name, or a value
 * that drifts away from snake_case, would silently point two logical tables at
 * one physical table. The TableNames / ImageMode union types are derived from
 * these objects, so the runtime values are what actually need pinning.
 */
import { describe, it, expect } from 'vitest'
import { tableNames, imageMode } from './tables'

describe('tableNames', () => {
  it('maps every logical key to a distinct physical table name', () => {
    const physical = Object.values(tableNames)
    expect(new Set(physical).size).toBe(physical.length)
  })

  it('uses snake_case physical names only', () => {
    for (const name of Object.values(tableNames)) {
      expect(name, name).toMatch(/^[a-z]+(_[a-z]+)*$/)
    }
  })

  it('keeps the documented core tables present', () => {
    // a representative slice the rest of the codebase imports by key
    expect(tableNames.token).toBe('token')
    expect(tableNames.listToken).toBe('list_token')
    expect(tableNames.imageVariant).toBe('image_variant')
    expect(tableNames.listSubmission).toBe('list_submission')
  })
})

describe('imageMode', () => {
  it('exposes exactly the save and link modes', () => {
    expect(imageMode).toEqual({ SAVE: 'save', LINK: 'link' })
  })

  it('has distinct lowercase values', () => {
    const values = Object.values(imageMode)
    expect(new Set(values).size).toBe(values.length)
    for (const value of values) expect(value).toMatch(/^[a-z]+$/)
  })
})
