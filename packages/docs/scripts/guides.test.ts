import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  GUIDES,
  buildGuide,
  convertBody,
  joinPages,
  parsePage,
  sortPages,
  writeGuides,
  type GuideDefinition,
  type Page,
} from './guides.ts'

const siteUrl = 'https://docs.example.test'

const page = (overrides: Partial<Page> = {}): Page => ({
  sourceName: 'a.md',
  title: 'A',
  order: undefined,
  draft: false,
  body: 'text',
  ...overrides,
})

describe('parsePage', () => {
  it('reads the title, the sidebar order and the body', () => {
    const parsed = parsePage('---\ntitle: Images\nsidebar:\n  order: 3\n---\nBody text\n', 'images.md')
    expect(parsed).toEqual({ sourceName: 'images.md', title: 'Images', order: 3, draft: false, body: 'Body text\n' })
  })

  it('treats a page without an order as unordered, and honours draft', () => {
    const parsed = parsePage('---\ntitle: T\ndraft: true\n---\nx', 't.md')
    expect(parsed.order).toBeUndefined()
    expect(parsed.draft).toBe(true)
  })

  it('does not take a text order as a number', () => {
    expect(parsePage('---\ntitle: T\nsidebar:\n  order: first\n---\nx', 't.md').order).toBeUndefined()
  })

  it('reads windows line endings', () => {
    expect(parsePage('---\r\ntitle: T\r\n---\r\nbody', 't.md').body).toBe('body')
  })

  it('refuses a page with no frontmatter, and names the page', () => {
    expect(() => parsePage('# Just a heading', 'bare.md')).toThrow('bare.md: the page has no frontmatter')
  })

  it('refuses a page with empty frontmatter or no title, and names the page', () => {
    expect(() => parsePage('---\n\n---\nx', 'empty.md')).toThrow('empty.md: the frontmatter has no title')
    expect(() => parsePage('---\ndescription: d\n---\nx', 'notitle.md')).toThrow('no title')
    expect(() => parsePage('---\ntitle: ""\n---\nx', 'blank.md')).toThrow('no title')
  })
})

describe('sortPages', () => {
  it('orders by sidebar order, then by path, with unordered pages last', () => {
    const sorted = sortPages([
      page({ sourceName: 'z.md', order: 1 }),
      page({ sourceName: 'none-b.md' }),
      page({ sourceName: 'a.md', order: 2 }),
      page({ sourceName: 'none-a.md' }),
      page({ sourceName: 'b.md', order: 2 }),
    ])
    expect(sorted.map((entry) => entry.sourceName)).toEqual(['z.md', 'a.md', 'b.md', 'none-a.md', 'none-b.md'])
  })

  it('leaves the input array alone', () => {
    const input = [page({ sourceName: 'b.md' }), page({ sourceName: 'a.md' })]
    sortPages(input)
    expect(input.map((entry) => entry.sourceName)).toEqual(['b.md', 'a.md'])
  })
})

describe('convertBody', () => {
  const convert = (body: string) => convertBody(body, { siteUrl })

  it('moves every heading down one level and stops at level six', () => {
    expect(convert('## Two\n### Three\n#### Four\n##### Five\n###### Six')).toBe(
      '### Two\n#### Three\n##### Four\n###### Five\n###### Six',
    )
  })

  it('does not treat a hash without a space as a heading', () => {
    expect(convert('#hashtag and ##tag')).toBe('#hashtag and ##tag')
  })

  it('copies fenced code exactly, including headings, imports, tags and links', () => {
    const fenced = '```md\n## Not a heading\nimport x from "y"\n<Tabs>\n[a](/b)\n:::note\n```'
    expect(convert(fenced)).toBe(fenced)
  })

  it('copies a tilde fence the same way and resumes converting after it closes', () => {
    expect(convert('~~~\n# keep\n~~~\n## change')).toBe('~~~\n# keep\n~~~\n### change')
  })

  it('drops import and export lines but keeps prose that starts with a similar word', () => {
    expect(convert("import { Tabs } from '@astrojs/starlight/components'\nexport const x = 1\nimporting is fine")).toBe(
      'importing is fine',
    )
  })

  it('drops component tag lines and keeps the text inside them', () => {
    expect(convert('<Tabs>\n<TabItem label="npm">\nrun it\n</TabItem>\n<Badge text="new" />\n</Tabs>')).toBe('run it')
  })

  it('keeps inline html and lowercase tags', () => {
    expect(convert('<br>\n<details>\nx')).toBe('<br>\n<details>\nx')
  })

  it('turns a directive into a bold label and drops its closing line', () => {
    expect(convert(':::note\nRemember this.\n:::\n:::caution[Careful]\nIt bites.\n:::')).toBe(
      '**Note:**\nRemember this.\n**Careful:**\nIt bites.',
    )
  })

  it('reads a directive that carries attributes', () => {
    expect(convert(':::tip[Fast]{icon="rocket"}\nx\n:::')).toBe('**Fast:**\nx')
  })

  it('makes root-relative links absolute and leaves other links alone', () => {
    expect(
      convert('[a](/api-reference/images/) [b](https://x.test/y) [c](//cdn.test/z) [d](./local) [e](/p#frag)'),
    ).toBe(
      `[a](${siteUrl}/api-reference/images/) [b](https://x.test/y) [c](//cdn.test/z) [d](./local) [e](${siteUrl}/p#frag)`,
    )
  })

  it('reads windows line endings and trims the result', () => {
    expect(convert('\r\n## A\r\ntext\r\n\r\n')).toBe('### A\ntext')
  })
})

describe('joinPages', () => {
  it('writes the document title, then each page title as a second-level heading with its converted body', () => {
    const document = joinPages(
      'Guide',
      [page({ title: 'One', body: '## Part\ntext' }), page({ title: 'Two', body: 'more' })],
      { siteUrl },
    )
    expect(document).toBe('# Guide\n\n## One\n\n### Part\ntext\n\n## Two\n\nmore\n')
  })
})

describe('building from a directory', () => {
  let contentDirectory: string
  let outputDirectory: string

  beforeEach(async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'guides-'))
    contentDirectory = path.join(root, 'content')
    outputDirectory = path.join(root, 'dist')
    await mkdir(contentDirectory)
  })

  afterEach(async () => {
    await rm(path.dirname(contentDirectory), { recursive: true, force: true })
  })

  const guide: GuideDefinition = { directory: 'topic', filename: 'topic.md', title: 'Topic Guide' }

  const writePage = async (name: string, source: string) => {
    const file = path.join(contentDirectory, guide.directory, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, source)
  }

  it('joins the pages in sidebar order, reaches subdirectories, and skips drafts and other files', async () => {
    await writePage('second.mdx', '---\ntitle: Second\nsidebar:\n  order: 2\n---\n## Deep\nlast')
    await writePage('first.md', '---\ntitle: First\nsidebar:\n  order: 1\n---\nfirst text')
    await writePage('nested/third.md', '---\ntitle: Third\nsidebar:\n  order: 3\n---\nnested text')
    await writePage('hidden.md', '---\ntitle: Hidden\ndraft: true\n---\nsecret')
    await writePage('image.png', 'not a page')

    expect(await buildGuide(guide, { contentDirectory, siteUrl })).toBe(
      '# Topic Guide\n\n## First\n\nfirst text\n\n## Second\n\n### Deep\nlast\n\n## Third\n\nnested text\n',
    )
  })

  it('answers null for a directory that does not exist', async () => {
    expect(await buildGuide(guide, { contentDirectory, siteUrl })).toBeNull()
  })

  it('answers null when every page is a draft', async () => {
    await writePage('only.md', '---\ntitle: Only\ndraft: true\n---\nx')
    expect(await buildGuide(guide, { contentDirectory, siteUrl })).toBeNull()
  })

  it('names the broken page when one cannot be read', async () => {
    await writePage('broken.md', 'no frontmatter')
    await expect(buildGuide(guide, { contentDirectory, siteUrl })).rejects.toThrow('topic/broken.md')
  })

  it('writes each guide that has pages under skills/ and skips the others', async () => {
    await writePage('only.md', '---\ntitle: Only\n---\nbody')
    const guides = [guide, { directory: 'absent', filename: 'absent.md', title: 'Absent' }]

    const written = await writeGuides({ contentDirectory, outputDirectory, siteUrl, guides })

    expect(written).toEqual(['topic.md'])
    expect(await readdir(path.join(outputDirectory, 'skills'))).toEqual(['topic.md'])
    expect(await readFile(path.join(outputDirectory, 'skills', 'topic.md'), 'utf8')).toBe(
      '# Topic Guide\n\n## Only\n\nbody\n',
    )
  })

  it('writes nothing, not even the directory, when no guide has pages', async () => {
    expect(await writeGuides({ contentDirectory, outputDirectory, siteUrl, guides: [guide] })).toEqual([])
    await expect(readdir(path.join(outputDirectory, 'skills'))).rejects.toThrow()
  })

  it('builds the published guides by default', async () => {
    await mkdir(path.join(contentDirectory, 'api-reference'))
    await writeFile(path.join(contentDirectory, 'api-reference', 'a.md'), '---\ntitle: A\n---\nx')

    expect(await writeGuides({ contentDirectory, outputDirectory, siteUrl })).toEqual(['api-reference.md'])
  })
})

describe('GUIDES', () => {
  it('names the three files the server has always published', () => {
    expect(GUIDES.map((entry) => entry.filename)).toEqual(['api-reference.md', 'list-management.md', 'self-hosting.md'])
    expect(GUIDES.map((entry) => entry.directory)).toEqual(['api-reference', 'list-management', 'self-hosting'])
  })
})
