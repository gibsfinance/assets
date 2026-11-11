import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { renderSql } from './__testing__/drizzle-harness'
import { imageColumnsWithoutStoredBytes, unexportedBytesSql } from './image-columns'
import * as s from './schema'

describe('unexportedBytesSql', () => {
  it('takes the bytes from the row only while it has no digest', () => {
    expect(renderSql(unexportedBytesSql)).toBe('CASE WHEN "image"."content_sha256" IS NULL THEN "image"."content" END')
  })
})

describe('imageColumnsWithoutStoredBytes', () => {
  it('names every column of the image table, so a whole-row query loses none', () => {
    expect(Object.keys(imageColumnsWithoutStoredBytes).sort()).toEqual(Object.keys(getTableColumns(s.image)).sort())
  })

  it('narrows content and passes every other column through untouched', () => {
    const { content, ...rest } = imageColumnsWithoutStoredBytes
    expect(content).toBe(unexportedBytesSql)
    for (const [name, column] of Object.entries(rest)) {
      expect(column, name).toBe((s.image as unknown as Record<string, unknown>)[name])
    }
  })
})
