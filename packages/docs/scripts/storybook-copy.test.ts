import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { copyStorybook } from './storybook-copy.ts'

describe('copyStorybook', () => {
  let directory: string
  let storybookDirectory: string
  let siteDirectory: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'storybook-copy-'))
    storybookDirectory = path.join(directory, 'storybook-static')
    siteDirectory = path.join(directory, 'dist')
    await mkdir(path.join(storybookDirectory, 'assets'), { recursive: true })
    await mkdir(siteDirectory, { recursive: true })
    await writeFile(path.join(storybookDirectory, 'index.html'), '<html>storybook</html>')
    await writeFile(path.join(storybookDirectory, 'assets', 'app.js'), 'export {}')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('copies every file, nested ones included, to the storybook directory of the site', async () => {
    const destination = await copyStorybook({ storybookDirectory, siteDirectory })

    expect(destination).toBe(path.join(siteDirectory, 'storybook'))
    expect(await readFile(path.join(destination, 'index.html'), 'utf8')).toBe('<html>storybook</html>')
    expect(await readFile(path.join(destination, 'assets', 'app.js'), 'utf8')).toBe('export {}')
  })

  it('removes files left by an earlier copy', async () => {
    const stale = path.join(siteDirectory, 'storybook', 'old.html')
    await mkdir(path.dirname(stale), { recursive: true })
    await writeFile(stale, 'old')

    await copyStorybook({ storybookDirectory, siteDirectory })

    await expect(readFile(stale, 'utf8')).rejects.toThrow()
  })

  it('refuses a Storybook that was not built, and leaves the site untouched', async () => {
    await rm(storybookDirectory, { recursive: true })

    await expect(copyStorybook({ storybookDirectory, siteDirectory })).rejects.toThrow(/No built Storybook found/)
    await expect(readFile(path.join(siteDirectory, 'storybook', 'index.html'), 'utf8')).rejects.toThrow()
  })
})
