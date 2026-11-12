/**
 * @module write-json
 * Writes a value to a JSON file, creating the directory first.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Write `value` as formatted JSON to `filePath`.
 *
 * @param filePath Where to write. Missing directories are created.
 * @param value Anything `JSON.stringify` accepts.
 */
export const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}
