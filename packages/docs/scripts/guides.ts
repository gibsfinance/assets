/**
 * @module guides
 * Builds the three single-file markdown guides that gib.show has always served at
 * `/skills/api-reference.md`, `/skills/list-management.md` and `/skills/self-hosting.md`.
 *
 * The pages under `src/content/docs/` are the only copy of that text. This module reads one
 * content directory, puts its pages in sidebar order and joins them into one markdown
 * document, so the old URLs keep answering without a second copy to keep in step.
 *
 * What a page may contain, so that it survives the join:
 * - Frontmatter with `title`, and `sidebar.order` for its place. A page with `draft: true` is skipped.
 * - Plain markdown. Headings are moved down one level, because the page title becomes a heading.
 * - Starlight `:::note`, `:::tip`, `:::caution` and `:::danger` blocks. The opening line becomes a
 *   bold label and the closing line is dropped.
 * - MDX `import` and `export` lines (one line each) and component tags that sit alone on their own
 *   line, such as `<Tabs>` or `<Aside type="note">`. These are dropped and the text inside is kept.
 * - Links that start with `/` are made absolute with the site address.
 *
 * Fenced code blocks are copied exactly as written.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

/** One published guide: the content directory it is built from and the file name it is served as. */
export interface GuideDefinition {
  /** Directory under the content root, for example `api-reference`. */
  directory: string
  /** File name served under `/skills/`, for example `api-reference.md`. */
  filename: string
  /** The heading at the top of the joined document. */
  title: string
}

/** The guides gib.show publishes. The titles match the documents they replace. */
export const GUIDES: readonly GuideDefinition[] = [
  { directory: 'api-reference', filename: 'api-reference.md', title: 'Gib.Show API Reference' },
  { directory: 'list-management', filename: 'list-management.md', title: 'Token List Management' },
  { directory: 'self-hosting', filename: 'self-hosting.md', title: 'Self-Hosting Gib.Show' },
]

/** One content page, split into the parts the join needs. */
export interface Page {
  /** Path of the page below its directory; used for messages and as the last sort key. */
  sourceName: string
  title: string
  /** The page's `sidebar.order`, or `undefined` when it has none. */
  order: number | undefined
  draft: boolean
  body: string
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const PAGE_FILE = /\.mdx?$/
const FENCE = /^\s*(```|~~~)/
const IMPORT_OR_EXPORT_LINE = /^(import|export)\s.*$/
const COMPONENT_TAG_LINE = /^\s*<\/?[A-Z][\w.]*(\s[^>]*)?\/?>\s*$/
const DIRECTIVE_OPEN = /^:::(\w+)(?:\[(.*?)\])?(?:\{.*\})?\s*$/
const DIRECTIVE_CLOSE = /^:::\s*$/
const HEADING = /^(#{1,5})(\s)/
const ROOT_RELATIVE_LINK = /\]\((\/(?!\/)[^)\s]*)\)/g

/**
 * Split a page into frontmatter fields and body.
 *
 * @param source The full text of the page file.
 * @param sourceName The page's path, used in the error message.
 * @throws When the page has no frontmatter or no `title`, because such a page would fail the site build too.
 */
export const parsePage = (source: string, sourceName: string): Page => {
  const match = FRONTMATTER.exec(source)
  if (!match) throw new Error(`${sourceName}: the page has no frontmatter`)
  const fields = (parseYaml(match[1]) ?? {}) as { title?: unknown; draft?: unknown; sidebar?: { order?: unknown } }
  if (typeof fields.title !== 'string' || fields.title.length === 0) {
    throw new Error(`${sourceName}: the frontmatter has no title`)
  }
  const order = fields.sidebar?.order
  return {
    sourceName,
    title: fields.title,
    order: typeof order === 'number' ? order : undefined,
    draft: fields.draft === true,
    body: source.slice(match[0].length),
  }
}

/**
 * Order pages the way the sidebar does: by `sidebar.order`, then by path. A page without an order goes last.
 *
 * @returns A new array; the input is not changed.
 */
export const sortPages = (pages: readonly Page[]): Page[] =>
  [...pages].sort(
    (left, right) =>
      (left.order ?? Infinity) - (right.order ?? Infinity) || left.sourceName.localeCompare(right.sourceName),
  )

/** The text of a `:::type[Title]` opening line as a bold label, or `undefined` when the line is not one. */
const directiveLabel = (line: string): string | undefined => {
  const match = DIRECTIVE_OPEN.exec(line)
  if (!match) return undefined
  const label = match[2] ?? `${match[1][0].toUpperCase()}${match[1].slice(1)}`
  return `**${label}:**`
}

/**
 * Rewrite one line that is outside a code block.
 *
 * @returns The new line, or `undefined` when the line is dropped.
 */
const convertLine = (line: string, siteUrl: string): string | undefined => {
  if (IMPORT_OR_EXPORT_LINE.test(line) || COMPONENT_TAG_LINE.test(line) || DIRECTIVE_CLOSE.test(line)) return undefined
  const label = directiveLabel(line)
  if (label !== undefined) return label
  return line.replace(HEADING, '$1#$2').replace(ROOT_RELATIVE_LINK, `](${siteUrl}$1)`)
}

/**
 * Convert a page body for the joined document: heading levels move down one, MDX-only syntax is
 * removed and root-relative links become absolute. Fenced code blocks pass through unchanged.
 *
 * @param body The page text after the frontmatter.
 * @param options.siteUrl The site address that root-relative links are given, with no trailing slash.
 */
export const convertBody = (body: string, options: { siteUrl: string }): string => {
  let insideFence = false
  const converted: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const isFenceLine = FENCE.test(line)
    if (isFenceLine) insideFence = !insideFence
    const next = insideFence || isFenceLine ? line : convertLine(line, options.siteUrl)
    if (next !== undefined) converted.push(next)
  }
  return converted.join('\n').trim()
}

/**
 * Join pages, already in order, into one markdown document.
 *
 * @returns The document, ending in one newline.
 */
export const joinPages = (title: string, pages: readonly Page[], options: { siteUrl: string }): string => {
  const sections = pages.map((page) => `## ${page.title}\n\n${convertBody(page.body, options)}`)
  return `${[`# ${title}`, ...sections].join('\n\n')}\n`
}

/** Every page file below a directory, as paths relative to it. A missing directory has none. */
const listPageFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { recursive: true }).catch(() => [] as string[])
  return entries.filter((entry) => PAGE_FILE.test(entry))
}

/**
 * Build one guide from its content directory.
 *
 * @returns The markdown document, or `null` when the directory holds no published page.
 */
export const buildGuide = async (
  guide: GuideDefinition,
  options: { contentDirectory: string; siteUrl: string },
): Promise<string | null> => {
  const directory = path.join(options.contentDirectory, guide.directory)
  const files = await listPageFiles(directory)
  const pages = await Promise.all(
    files.map(async (file) =>
      parsePage(await readFile(path.join(directory, file), 'utf8'), `${guide.directory}/${file}`),
    ),
  )
  const published = sortPages(pages.filter((page) => !page.draft))
  if (published.length === 0) return null
  return joinPages(guide.title, published, { siteUrl: options.siteUrl })
}

/**
 * Write every guide that has pages to `<outputDirectory>/skills/<filename>`.
 *
 * A guide with no pages writes nothing, so a build made before the content exists still succeeds and
 * the server keeps answering from its older copy.
 *
 * @returns The names of the files written, in guide order.
 */
export const writeGuides = async (options: {
  contentDirectory: string
  outputDirectory: string
  siteUrl: string
  guides?: readonly GuideDefinition[]
}): Promise<string[]> => {
  const skillsDirectory = path.join(options.outputDirectory, 'skills')
  const written: string[] = []
  for (const guide of options.guides ?? GUIDES) {
    const document = await buildGuide(guide, options)
    if (document === null) continue
    await mkdir(skillsDirectory, { recursive: true })
    await writeFile(path.join(skillsDirectory, guide.filename), document)
    written.push(guide.filename)
  }
  return written
}
