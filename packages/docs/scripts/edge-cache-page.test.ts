import { describe, expect, it } from 'vitest'
import {
  EDGE_CACHE_BLOCK_END,
  EDGE_CACHE_BLOCK_START,
  extractMarkedBlock,
  renderMarkdownTable,
  renderRulesBlock,
  replaceMarkedBlock,
} from './edge-cache-page.ts'
import { sanitizeRuleSet } from './edge-cache-rules.ts'
import { CONTENT_RULE_ANSWER, PAGE_RULE_ANSWER } from './edge-cache-fixtures.ts'

const sampleRules = sanitizeRuleSet([PAGE_RULE_ANSWER, CONTENT_RULE_ANSWER])

describe('renderMarkdownTable', () => {
  it('pads every column to its widest cell, the way prettier does', () => {
    expect(
      renderMarkdownTable(
        ['Name', 'Yes'],
        [
          ['a', 'longer cell'],
          ['bb', 'c'],
        ],
      ),
    ).toBe(
      ['| Name | Yes         |', '| ---- | ----------- |', '| a    | longer cell |', '| bb   | c           |'].join(
        '\n',
      ),
    )
  })

  it('gives a short column the minimum width of three', () => {
    expect(renderMarkdownTable(['a'], [['b']])).toBe(['| a   |', '| --- |', '| b   |'].join('\n'))
  })

  it('treats a missing cell as blank', () => {
    expect(renderMarkdownTable(['one', 'two'], [['x']])).toBe(
      ['| one | two |', '| --- | --- |', '| x   |     |'].join('\n'),
    )
  })
})

describe('renderRulesBlock', () => {
  it('draws the rules as a table, then each expression as a labelled code block', () => {
    const block = renderRulesBlock(sampleRules)
    expect(block).toContain('| content                                    | Yes     | Yes              |')
    expect(block).toContain('**content**\n\n```text\n(http.request.uri.path wildcard r"/image/*")')
    expect(block).toContain(
      '**page: cache index.html at the edge for 60s**\n\n```text\n(http.host in {"gib.show" "staging.gib.show"}',
    )
  })

  it('says No for a rule that is disabled or does not cache', () => {
    const block = renderRulesBlock(
      sanitizeRuleSet([{ ...CONTENT_RULE_ANSWER, enabled: false, action_parameters: { cache: false } }]),
    )
    expect(block).toContain('| content | No      | No               | Not kept at the edge')
  })
})

describe('replaceMarkedBlock and extractMarkedBlock', () => {
  const page = `Intro.\n\n${EDGE_CACHE_BLOCK_START}\nold table\n${EDGE_CACHE_BLOCK_END}\n\nOutro.\n`

  it('replaces the text between the markers and keeps everything else', () => {
    expect(replaceMarkedBlock(page, 'new table')).toBe(
      `Intro.\n\n${EDGE_CACHE_BLOCK_START}\n\nnew table\n\n${EDGE_CACHE_BLOCK_END}\n\nOutro.\n`,
    )
  })

  it('reads back the block it wrote', () => {
    expect(extractMarkedBlock(replaceMarkedBlock(page, 'new table'))).toBe('new table')
  })

  it('reads the text between the markers without surrounding blank lines', () => {
    expect(extractMarkedBlock(page)).toBe('old table')
  })

  it('refuses a page with no start marker', () => {
    expect(() => extractMarkedBlock(`x ${EDGE_CACHE_BLOCK_END}`)).toThrow('the page has no edge cache block')
  })

  it('refuses a page with no end marker', () => {
    expect(() => replaceMarkedBlock(`x ${EDGE_CACHE_BLOCK_START}`, 'b')).toThrow('the page has no edge cache block')
  })

  it('refuses a page whose end marker comes before its start marker', () => {
    expect(() => extractMarkedBlock(`${EDGE_CACHE_BLOCK_END} x ${EDGE_CACHE_BLOCK_START}`)).toThrow(
      'the page has no edge cache block',
    )
  })
})
