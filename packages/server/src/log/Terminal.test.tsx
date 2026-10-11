import React from 'react'
import { render } from 'ink'
import { describe, expect, it, vi } from 'vitest'
import { Terminal } from './Terminal'
import * as types from './types'
import { createInkStreams, inkOptionsFor } from './__testing__/ink-harness'

// Every Ink render builds a layout engine and a React tree; on a busy runner one
// render can take most of the default five seconds.
vi.setConfig({ testTimeout: 15_000 })

/**
 * Render a node into a fake terminal and return the text of the last frame,
 * with colour and cursor escapes removed.
 */
const renderToText = (node: React.ReactNode) => {
  const streams = createInkStreams()
  // Outside interactive mode Ink holds back everything but the final frame and
  // writes it once, on unmount, so the frames joined together are that one frame.
  const instance = render(node, { ...inkOptionsFor(streams), debug: false, interactive: false })
  instance.unmount()
  instance.cleanup()
  return streams.frames.join('')
}

/** A counter the way App builds one: a set of finished ids, and a set of expected ids or null. */
const counter = (current: string[], total: string[] | null = null): types.Counter => ({
  current: new Set(current),
  total: total ? new Set(total) : null,
})

const row = (id: string | null, overrides: Partial<types.TerminalRow> = {}): types.TerminalRow => ({
  fullId: id ?? '',
  type: types.terminalRowTypes.SETUP,
  id,
  lastUpdated: new Date(0),
  counters: new Map(),
  sections: new Map(),
  ...overrides,
})

const section = (id: string, rows: types.TerminalRow[], overrides: Partial<types.Section> = {}): types.Section => ({
  id,
  limit: 4,
  rows: new Map(rows.map((member) => [member.id!, member])),
  ...overrides,
})

/** The root row App creates: no id, and only sections beneath it. */
const root = (...sections: types.Section[]) =>
  row(null, { type: types.terminalRowTypes.SUMMARY, sections: new Map(sections.map((s) => [s.id, s])) })

const draw = (rootRow: types.TerminalRow | null) =>
  renderToText(<Terminal terminated={false} finalNote={null} row={rootRow} />)

const lines = (text: string) => text.split('\n').filter((line) => line.length > 0)

describe('Terminal', () => {
  it('draws nothing before the program has created its root row', () => {
    // utils/index.ts creates the root at module load; until then there is nothing to show,
    // and a crash here would take the whole collector down before it logs anything.
    expect(draw(null).trim()).toBe('')
  })

  it('does not draw the root row itself, only the sections beneath it', () => {
    // The root has a null id. Drawing it would print an empty line above every run.
    const text = draw(root(section('main', [row('alpha')])))
    expect(lines(text)).toEqual([expect.stringContaining('alpha')])
  })

  it('draws the section rows of nested rows beneath their parent', () => {
    const child = row('child')
    const parent = row('parent', { sections: new Map([['inner', section('inner', [child])]]) })
    const text = draw(root(section('main', [parent])))
    const drawn = lines(text)
    expect(drawn[0]).toContain('parent')
    expect(drawn[1]).toContain('child')
  })
})

describe('Row', () => {
  it.each([
    [types.terminalRowTypes.SUMMARY, '🔍'],
    [types.terminalRowTypes.SETUP, '🔧'],
    [types.terminalRowTypes.STORAGE, '💾'],
    [types.terminalRowTypes['-'], '⏹'],
  ])('marks a %s row with its icon so a reader can tell the stage at a glance', (type, icon) => {
    const text = draw(root(section('main', [row('alpha', { type })])))
    expect(text).toContain(`${icon} alpha`)
  })

  it('draws progress as finished over expected with the counter icon', () => {
    const counters = new Map([['token', counter(['a', 'b'], ['a', 'b', 'c'])]])
    const text = draw(root(section('main', [row('alpha', { counters })])))
    expect(text).toContain('alpha 2/3=📀')
  })

  it('leaves a counter out of the progress group until its total is known', () => {
    // A counter whose total is still null has no denominator, so "2/?" would be a lie.
    const counters = new Map([['token', counter(['a', 'b'])]])
    const text = draw(root(section('main', [row('alpha', { counters })])))
    expect(text).not.toContain('📀')
    expect(text).not.toContain('/')
  })

  it('draws a counter that is not a progress type as name=count', () => {
    const counters = new Map([['tasks', counter(['a', 'b', 'c'])]])
    const text = draw(root(section('main', [row('alpha', { counters })])))
    expect(text).toContain('tasks=3')
  })

  it('draws a log counter as name=count', () => {
    const counters = new Map([['eror', counter(['a'])]])
    const text = draw(root(section('main', [row('alpha', { counters })])))
    expect(text).toContain('eror=1')
  })

  it('draws the message and the key-value pairs', () => {
    const text = draw(root(section('main', [row('alpha', { message: 'fetching', kv: { page: 2, limit: 50 } })])))
    expect(text).toContain('fetching')
    expect(text).toContain('page=2 limit=50')
  })

  it('draws nothing for a row that hides itself', () => {
    const text = draw(root(section('main', [row('alpha', { hide: true }), row('beta')])))
    expect(text).not.toContain('alpha')
    expect(text).toContain('beta')
  })

  it('draws nothing for a section that hides itself', () => {
    const text = draw(root(section('main', [row('alpha')], { hide: true })))
    expect(text.trim()).toBe('')
  })

  it('does not reserve identifier width when every sibling has an empty identifier', () => {
    // omnibridge and pls369 issue block tasks with id ''. With no identifier to align,
    // the column must collapse instead of padding every line with blanks.
    const counters = new Map([['tasks', counter(['a'])]])
    const text = draw(root(section('main', [row('', { counters })])))
    expect(lines(text)[0]).toBe(' 🔧  tasks=1')
  })
})

describe('column alignment', () => {
  it('pads shorter identifiers to the longest sibling so the columns line up', () => {
    const text = draw(root(section('main', [row('a'), row('longer-name')])))
    const [first, second] = lines(text)
    expect(first.indexOf('a')).toBe(second.indexOf('longer-name') + 'longer-name'.length - 1)
  })

  it('pads progress counts to the widest count among siblings', () => {
    const wide = new Map([['token', counter(['1'], ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])]])
    const narrow = new Map([['token', counter(['1'], ['1', '2'])]])
    const text = draw(root(section('main', [row('wide', { counters: wide }), row('narrow', { counters: narrow })])))
    const [first, second] = lines(text)
    // Both rows put the "=" sign in the same column, so the totals read as a column.
    expect(first.indexOf('=')).toBe(second.indexOf('='))
  })

  it('sizes a column from the finished count when a sibling has no total yet', () => {
    // A counter without a total is sized by what it has finished so far; the other row,
    // which has a total, still gets a column wide enough for it.
    const open = new Map([['token', counter(['1', '2', '3'])]])
    const closed = new Map([['token', counter(['1'], ['1', '2'])]])
    const text = draw(root(section('main', [row('open', { counters: open }), row('closed', { counters: closed })])))
    expect(text).toContain('closed 1/2=📀')
  })
})

describe('Section', () => {
  it('shows only the most recent rows up to the section limit', () => {
    // A long run issues hundreds of rows. Without the limit the live view scrolls off screen.
    const rows = ['one', 'two', 'three', 'four'].map((id) => row(id))
    const text = draw(root(section('main', rows, { limit: 2 })))
    expect(text).not.toContain('one')
    expect(text).not.toContain('two')
    expect(text).toContain('three')
    expect(text).toContain('four')
  })

  it('shows every row when the limit is infinite', () => {
    const rows = ['one', 'two', 'three'].map((id) => row(id))
    const text = draw(root(section('main', rows, { limit: Infinity })))
    expect(lines(text)).toHaveLength(3)
  })

  it('collapses completed rows into one summary line instead of one line each', () => {
    const done = types.terminalRowTypes.COMPLETE
    const rows = [row('alpha', { type: done }), row('beta', { type: done }), row('gamma')]
    const text = draw(root(section('main', rows)))
    const drawn = lines(text)
    expect(drawn[0]).toContain('2 done')
    expect(drawn[1]).toContain('alpha, beta')
    expect(drawn[2]).toContain('gamma')
    expect(text).not.toContain('🎉 alpha')
  })

  it('hides completed tasks entirely because they are internal detail', () => {
    const rows = [row('task-1', { type: types.terminalRowTypes.COMPLETE, isTask: true }), row('live')]
    const text = draw(root(section('main', rows)))
    expect(text).not.toContain('task-1')
    expect(text).not.toContain('done')
    expect(text).toContain('live')
  })

  it('still draws a task that has not completed', () => {
    const text = draw(root(section('main', [row('task-1', { isTask: true })])))
    expect(text).toContain('task-1')
  })
})

describe('CompletedSummary', () => {
  const done = types.terminalRowTypes.COMPLETE

  it('adds up each progress counter across the completed rows', () => {
    const first = new Map([['token', counter(['a', 'b'])]])
    const second = new Map([['token', counter(['c'])]])
    const rows = [row('alpha', { type: done, counters: first }), row('beta', { type: done, counters: second })]
    const text = draw(root(section('main', rows)))
    expect(text).toContain('2 done 📀=3')
  })

  it('adds up counters that are not progress types by name', () => {
    const counters = new Map([['tasks', counter(['a', 'b'])]])
    const text = draw(root(section('main', [row('alpha', { type: done, counters })])))
    expect(text).toContain('1 done tasks=2')
  })

  it('shows a warning count, which does not fail the row', () => {
    const counters = new Map([['warn', counter(['a', 'b'])]])
    const text = draw(root(section('main', [row('alpha', { type: done, counters })])))
    expect(text).toContain('1 done ⚠️=2')
    expect(text).not.toContain('failed')
  })

  it('omits a log counter that is back to zero', () => {
    // A warning that was raised and then cleared leaves an empty counter behind.
    const counters = new Map([['warn', counter([])]])
    const text = draw(root(section('main', [row('alpha', { type: done, counters })])))
    expect(text).not.toContain('⚠️')
  })

  it('does not reserve identifier width when every row has an empty identifier', () => {
    const text = draw(root(section('main', [row('', { type: done })])))
    expect(lines(text)[0]).toBe(' 🎉 1 done')
  })

  it('leaves unnamed rows out of the name list', () => {
    const rows = [row('', { type: done }), row('beta', { type: done })]
    const text = draw(root(section('main', rows)))
    expect(lines(text)[1].trim()).toBe('beta')
  })
})

describe('FailedSummary', () => {
  const done = types.terminalRowTypes.COMPLETE

  it('separates a completed row with errors from the ones that succeeded', () => {
    // Folding a failure into "N done" would hide it from the person watching the run.
    const failing = new Map([['eror', counter(['x'])]])
    const rows = [row('bad', { type: done, counters: failing }), row('good', { type: done })]
    const drawn = lines(draw(root(section('main', rows))))
    expect(drawn[0]).toContain('1 failed')
    expect(drawn[1]).toContain('bad 💥1')
    expect(drawn[2]).toContain('1 done')
    expect(drawn[3]).toContain('good')
  })

  it('names each failed row with its error and warning counts', () => {
    const counters = new Map([
      ['eror', counter(['x', 'y'])],
      ['warn', counter(['z'])],
    ])
    const text = draw(root(section('main', [row('bad', { type: done, counters })])))
    expect(text).toContain('bad 💥2 ⚠️1')
  })

  it('leaves out a warning count that is back to zero', () => {
    const counters = new Map([
      ['eror', counter(['x'])],
      ['warn', counter([])],
    ])
    const text = draw(root(section('main', [row('bad', { type: done, counters })])))
    expect(text).toContain('bad 💥1')
    expect(text).not.toContain('⚠️')
  })

  it('adds up the progress made by the rows that failed', () => {
    const counters = new Map([
      ['eror', counter(['x'])],
      ['network', counter(['1', '2'])],
    ])
    const text = draw(root(section('main', [row('bad', { type: done, counters })])))
    expect(text).toContain('1 failed 🗄️=2')
  })

  it('does not reserve identifier width when every failed row has an empty identifier', () => {
    const counters = new Map([['eror', counter(['x'])]])
    const text = draw(root(section('main', [row('', { type: done, counters })])))
    expect(lines(text)[0]).toBe(' 💥 1 failed')
  })

  it('treats a row whose error counter was cleared as having succeeded', () => {
    const counters = new Map([['eror', counter([])]])
    const text = draw(root(section('main', [row('recovered', { type: done, counters })])))
    expect(text).toContain('1 done')
    expect(text).not.toContain('failed')
  })
})
