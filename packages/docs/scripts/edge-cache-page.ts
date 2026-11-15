/**
 * @module edge-cache-page
 * Writes the generated part of the caching page from the committed edge cache rules.
 *
 * The page cannot import a file at build time, so the generated part is text between two marker
 * comments in `api-reference/caching.md`. `export-edge-cache-rules.ts` rewrites that text from the
 * committed JSON, and a test keeps the committed page in step with the JSON. The page stays plain
 * markdown, so the single-file guide that the join makes from the same directory keeps the table too.
 */
import {
  describeBrowserLifetime,
  describeEdgeLifetime,
  type EdgeCacheRule,
  type EdgeCacheRuleSet,
} from './edge-cache-rules.ts'

/** The comment that opens the generated part. Text between the markers is replaced on every export. */
export const EDGE_CACHE_BLOCK_START = '<!-- edge-cache-rules:start -->'
/** The comment that closes the generated part. */
export const EDGE_CACHE_BLOCK_END = '<!-- edge-cache-rules:end -->'

/** The minimum width of a table column, which is also the width prettier gives a short column. */
const MINIMUM_COLUMN_WIDTH = 3

/**
 * Draw a markdown table with every column padded to the same width as the prettier formatter pads it,
 * so the committed table passes the formatting check unchanged.
 *
 * @param headers The column titles.
 * @param rows The cell text for each row. Every row has one cell per header.
 * @returns The table, without a trailing newline.
 */
export const renderMarkdownTable = (headers: readonly string[], rows: readonly (readonly string[])[]): string => {
  const widths = headers.map((header, column) =>
    Math.max(MINIMUM_COLUMN_WIDTH, header.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const drawRow = (cells: readonly string[]): string =>
    `| ${widths.map((width, column) => (cells[column] ?? '').padEnd(width)).join(' | ')} |`
  const delimiter = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`
  return [drawRow(headers), delimiter, ...rows.map(drawRow)].join('\n')
}

/** Plain words for a yes or no setting. */
const yesOrNo = (value: boolean): string => (value ? 'Yes' : 'No')

/** Table cells for one rule. The expression is not in the table; it is written under it. */
const ruleRow = (rule: EdgeCacheRule): string[] => [
  rule.description,
  yesOrNo(rule.enabled),
  yesOrNo(rule.cacheEnabled),
  describeEdgeLifetime(rule),
  describeBrowserLifetime(rule),
]

/** The expression of one rule, as a labelled code block that a reader can copy. */
const ruleExpression = (rule: EdgeCacheRule): string =>
  [`**${rule.description}**`, '', '```text', rule.expression, '```'].join('\n')

/**
 * Draw the generated part of the caching page: a table of the rules, then each rule's expression.
 *
 * @returns The text that goes between the two marker comments, without the markers themselves.
 */
export const renderRulesBlock = (ruleSet: EdgeCacheRuleSet): string => {
  const table = renderMarkdownTable(
    ['Rule', 'Enabled', 'Kept at the edge', 'Edge lifetime', 'Browser lifetime'],
    ruleSet.rules.map(ruleRow),
  )
  const expressions = ruleSet.rules.map(ruleExpression)
  return [table, ...expressions].join('\n\n')
}

/**
 * Find the two markers in order.
 *
 * @returns The index of the start marker and of the end marker.
 * @throws When either marker is missing or the end marker comes first.
 */
const locateMarkers = (source: string): { start: number; end: number } => {
  const start = source.indexOf(EDGE_CACHE_BLOCK_START)
  const end = source.indexOf(EDGE_CACHE_BLOCK_END)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`the page has no edge cache block between ${EDGE_CACHE_BLOCK_START} and ${EDGE_CACHE_BLOCK_END}`)
  }
  return { start, end }
}

/**
 * Replace the text between the markers with a new block.
 *
 * @throws When the markers are missing or out of order.
 */
export const replaceMarkedBlock = (source: string, block: string): string => {
  const markers = locateMarkers(source)
  return `${source.slice(0, markers.start + EDGE_CACHE_BLOCK_START.length)}\n\n${block}\n\n${source.slice(markers.end)}`
}

/**
 * Read the text between the markers, without the blank lines that surround it.
 *
 * @throws When the markers are missing or out of order.
 */
export const extractMarkedBlock = (source: string): string => {
  const markers = locateMarkers(source)
  return source.slice(markers.start + EDGE_CACHE_BLOCK_START.length, markers.end).trim()
}
