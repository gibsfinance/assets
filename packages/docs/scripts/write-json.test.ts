import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeJson } from './write-json.ts'

describe('writeJson', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'write-json-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('creates missing directories and writes formatted JSON ending in a newline', async () => {
    const filePath = path.join(directory, 'deep', 'er', 'value.json')

    await writeJson(filePath, { a: 1, b: ['x'] })

    expect(await readFile(filePath, 'utf8')).toBe('{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}\n')
  })
})
