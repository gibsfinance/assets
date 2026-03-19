import React from 'react'
import { Box, Text } from 'ink'
import _ from 'lodash'
import * as types from './types'

const emoji = {
  row: {
    summary: '🔍',
    setup: '🔧',
    storage: '💾',
    complete: '🎉',
    '-': '⏹',
  } as Record<types.TerminalRowType, string>,
  log: {
    prog: '⚡',
    warn: '⚠️',
    eror: '💥',
    info: '💬',
    dbug: '🐛',
    trac: '🔍',
  } as Record<types.TerminalLogType, string>,
  counter: {
    token: '📀',
    network: '🗄️',
    provider: '🎖️',
  } as Record<types.TerminalCounterType, string>,
} as const

type Padding = {
  id: number
  progress: Map<string, number>
}

/**
 * Aggregate counters from multiple completed rows into totals
 */
const aggregateCounters = (rows: types.TerminalRow[]) => {
  const totals = new Map<string, number>()
  for (const row of rows) {
    for (const [key, counter] of row.counters.entries()) {
      totals.set(key, (totals.get(key) ?? 0) + counter.current.size)
    }
  }
  return totals
}

/**
 * Collapsed summary of completed providers — single row with aggregate stats
 */
export const CompletedSummary: React.FC<{
  rows: types.TerminalRow[]
  padding: Padding
}> = (props) => {
  if (!props.rows.length) return <></>
  const totals = aggregateCounters(props.rows)
  const names = props.rows.map((r) => r.id).filter(Boolean)
  const counterKeys = Object.values(types.terminalCounterTypes) as string[]
  const logKeys = Object.values(types.terminalLogTypes) as string[]
  const progressTotals = [...totals.entries()].filter(([k]) => counterKeys.includes(k))
  const counterTotals = [...totals.entries()].filter(([k]) => !counterKeys.includes(k) && !logKeys.includes(k))
  const logTotals = [...totals.entries()].filter(([k]) => logKeys.includes(k) && totals.get(k)! > 0)
  return (
    <>
      <Box flexDirection="row" gap={1}>
        <Box width={3} justifyContent="flex-end">
          <Text dimColor>🎉</Text>
        </Box>
        <Box minWidth={props.padding.id || undefined} justifyContent="flex-end">
          <Text dimColor>{props.rows.length} done</Text>
        </Box>
        {progressTotals.map(([key, count]) => (
          <Text key={key} dimColor>
            {emoji.counter[key as types.TerminalCounterType] ?? key}={count}
          </Text>
        ))}
        {counterTotals.map(([key, count]) => (
          <Text key={key} dimColor>
            {key}={count}
          </Text>
        ))}
        {logTotals.map(([key, count]) => (
          <Text key={key} dimColor>
            {emoji.log[key as types.TerminalLogType] ?? key}={count}
          </Text>
        ))}
      </Box>
      <Box paddingLeft={4}>
        <Text dimColor wrap="truncate">
          {names.join(', ')}
        </Text>
      </Box>
    </>
  )
}

/**
 * Collapsed summary of failed providers — shows names and error counts
 */
export const FailedSummary: React.FC<{
  rows: types.TerminalRow[]
  padding: Padding
}> = (props) => {
  if (!props.rows.length) return <></>
  const totals = aggregateCounters(props.rows)
  const names = props.rows.map((r) => {
    const errors = r.counters.get(types.terminalLogTypes.EROR)
    const warns = r.counters.get(types.terminalLogTypes.WARN)
    const parts = [r.id]
    if (errors && errors.current.size > 0) parts.push(`💥${errors.current.size}`)
    if (warns && warns.current.size > 0) parts.push(`⚠️${warns.current.size}`)
    return parts.join(' ')
  })
  const counterKeys = Object.values(types.terminalCounterTypes) as string[]
  const progressTotals = [...totals.entries()].filter(([k]) => counterKeys.includes(k))
  return (
    <>
      <Box flexDirection="row" gap={1}>
        <Box width={3} justifyContent="flex-end">
          <Text color="red">💥</Text>
        </Box>
        <Box minWidth={props.padding.id || undefined} justifyContent="flex-end">
          <Text color="red">{props.rows.length} failed</Text>
        </Box>
        {progressTotals.map(([key, count]) => (
          <Text key={key} color="red">
            {emoji.counter[key as types.TerminalCounterType] ?? key}={count}
          </Text>
        ))}
      </Box>
      <Box paddingLeft={4}>
        <Text color="red" wrap="truncate">
          {names.join(', ')}
        </Text>
      </Box>
    </>
  )
}

const hasErrors = (row: types.TerminalRow) => {
  const errorCounter = row.counters.get(types.terminalLogTypes.EROR)
  return errorCounter && errorCounter.current.size > 0
}

/**
 * Section component renders active rows individually and collapses
 * completed/failed rows into aggregate summary lines.
 * Task-level completed rows are hidden entirely (they're internal detail).
 */
export const Section: React.FC<types.Section & { padding: Padding }> = (props) => {
  if (props.hide) return <></>
  const entries = [...props.rows.entries()]
  const active = entries.filter(([, r]) => r.type !== types.terminalRowTypes.COMPLETE)
  const completedNonTasks = entries.filter(([, r]) => r.type === types.terminalRowTypes.COMPLETE && !r.isTask)
  const succeeded = completedNonTasks.filter(([, r]) => !hasErrors(r))
  const failed = completedNonTasks.filter(([, r]) => hasErrors(r))
  const activeToRender = active.slice(-props.limit)
  return (
    <Box flexDirection="column">
      {failed.length > 0 && <FailedSummary rows={failed.map(([, r]) => r)} padding={props.padding} />}
      {succeeded.length > 0 && <CompletedSummary rows={succeeded.map(([, r]) => r)} padding={props.padding} />}
      {activeToRender.map(([mapKey, row]) => (
        <RowWithSections {...row} key={mapKey} padding={props.padding} />
      ))}
    </Box>
  )
}

export const Progress: React.FC<
  types.Counter & {
    total: number
    id: types.TerminalCounterType | string
    isTask?: boolean
    minWidth?: number
  }
> = (props) => {
  const progress = props.minWidth || undefined
  const emojiInput = emoji.counter[props.id as types.TerminalCounterType]
  const width = emojiInput ? 2 : undefined
  return (
    <Box display="flex" justifyContent="flex-end">
      <Box minWidth={progress} display="flex" justifyContent="flex-end">
        <Text dimColor={props.isTask}>{props.current.size}</Text>
      </Box>
      <Text dimColor={props.isTask}>/</Text>
      <Box minWidth={progress} display="flex" justifyContent="flex-start">
        <Text dimColor={props.isTask}>{props.total.size}</Text>
      </Box>
      <Text dimColor={props.isTask}>=</Text>
      <Box minWidth={width} display="flex" justifyContent="flex-start" marginRight={1}>
        <Text dimColor={props.isTask}>{emojiInput ?? props.id}</Text>
      </Box>
    </Box>
  )
}
export const Counter: React.FC<
  types.Counter & { id: types.TerminalCounterType | string; isTask?: boolean; minWidth?: number }
> = (props) => {
  return (
    <Box display="flex" flexDirection="row">
      <Text dimColor={props.isTask}>{emoji.counter[props.id as types.TerminalCounterType] ?? props.id}</Text>
      <Text dimColor={props.isTask}>=</Text>
      <Box minWidth={props.minWidth} display="flex" justifyContent="flex-start">
        <Text dimColor={props.isTask}>{props.current.size}</Text>
      </Box>
    </Box>
  )
}

export const Row: React.FC<types.TerminalRow & { padding: Padding }> = (props) => {
  if (props.hide) return <></>
  const kvEntries = Object.entries(props.kv ?? {})
  const counters = [...props.counters.entries()]
  const [logEntries, otherEntries] = _.partition(
    counters,
    ([key]) => !!types.terminalLogTypes[key.toUpperCase() as unknown as types.TerminalLogTypeKeys],
  )
  const [progressEntries, counterEntries] = _.partition(
    otherEntries,
    ([key]) => !!types.terminalCounterTypes[key.toUpperCase() as unknown as types.TerminalCounterTypeKeys],
  )
  return (
    <Box display="flex" flexDirection="row" gap={1}>
      <Box width={3} display="flex" justifyContent="flex-end">
        {props.isTask && props.type === types.terminalRowTypes.COMPLETE ? null : (
          <Text dimColor={props.isTask}>{emoji.row[props.type] ?? '?'}</Text>
        )}
      </Box>
      <Box minWidth={props.padding.id || undefined} display="flex" justifyContent="flex-end">
        <Text dimColor={props.isTask}>{props.id}</Text>
      </Box>
      {progressEntries.length ? (
        <Box display="flex" flexDirection="row" justifyContent="flex-start" gap={2}>
          {progressEntries.map(
            ([key, counter]) =>
              counter.total && (
                <Progress
                  {...(counter as types.Progress)}
                  id={key}
                  key={key}
                  isTask={props.isTask}
                  minWidth={props.padding.progress.get(key)}
                />
              ),
          )}
        </Box>
      ) : null}
      {counterEntries.length ? (
        <Box display="flex" flexDirection="row" justifyContent="flex-start" gap={2}>
          {counterEntries.map(([key, counter]) => (
            <Counter {...counter} id={key} key={key} isTask={props.isTask} minWidth={props.padding.progress.get(key)} />
          ))}
        </Box>
      ) : null}
      {props.message ? (
        <Box display="flex" justifyContent="flex-start">
          <Text dimColor={props.isTask}>{props.message}</Text>
        </Box>
      ) : null}
      {logEntries.length
        ? logEntries.map(([k, counter]) => (
            <Counter {...counter} id={k} key={k} isTask={props.isTask} minWidth={props.padding.progress.get(k)} />
          ))
        : null}
      {kvEntries.length ? (
        <Box display="flex" justifyContent="flex-start" flexDirection="row" gap={1}>
          <Text dimColor={props.isTask}>{kvEntries.map(([k, v]) => `${k}=${v}`).join(' ')}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

export const RowWithSections: React.FC<types.TerminalRow & { padding: Padding }> = (props) => {
  const sections = [...props.sections.entries()]
  const rows = sections.flatMap(([, section]) => Array.from(section.rows.values()))
  const childPadding = {
    id: rows.reduce((len, row) => Math.max(row.id === null ? 0 : row.id.length, len), props.padding.id),
    progress: rows.reduce((accum, row) => {
      for (const [key, counter] of row.counters.entries()) {
        const len = `${counter.total?.size ?? counter.current.size}`.length
        accum.set(key, Math.max(accum.get(key) ?? 0, len))
      }
      return accum
    }, new Map<string, number>()),
  } as Padding
  return (
    <Box flexDirection="column">
      {props.id !== null ? <Row {...props} padding={props.padding} /> : []}
      {sections.map(([sectionKey, section]) => (
        <Section {...section} key={sectionKey} padding={childPadding} />
      ))}
    </Box>
  )
}

export const Terminal: React.FC<types.RenderState> = (props) => {
  if (!props.row) return <></>
  return <RowWithSections {...props.row} padding={{ id: 0, progress: new Map() }} />
}
