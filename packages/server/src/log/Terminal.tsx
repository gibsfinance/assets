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
  progress: number[]
}

/**
 * Section component can render a list of rows
 * @param props Section props
 * @returns Section component
 */
export const Section: React.FC<types.Section & { padding: Padding }> = (props) => {
  if (props.hide) return <></>
  const toRender = [...props.rows.values()]
    .sort((a, b) => {
      const aIsComplete = a.type === types.terminalRowTypes.COMPLETE
      const bIsComplete = b.type === types.terminalRowTypes.COMPLETE
      if (aIsComplete && !bIsComplete) return -1
      if (!aIsComplete && bIsComplete) return 1
      return 0
    })
    .slice(-props.limit)
  return (
    <Box display="flex" flexDirection="column">
      {toRender.map((row, index) => (
        <RowWithSections {...row} key={`${props.id}-${index}`} padding={props.padding} />
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
  const widths = new Map(counters.map(([_k, counter], i) => [counter, props.padding.progress[i]] as const))
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
          <Text dimColor={props.isTask}>{emoji.row[props.type]}</Text>
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
                  minWidth={widths.get(counter)}
                />
              ),
          )}
        </Box>
      ) : null}
      {counterEntries.length ? (
        <Box display="flex" flexDirection="row" justifyContent="flex-start" gap={2}>
          {counterEntries.map(([key, counter]) => (
            <Counter {...counter} id={key} key={key} isTask={props.isTask} minWidth={widths.get(counter)} />
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
            <Counter {...counter} id={k} key={k} isTask={props.isTask} minWidth={widths.get(counter)} />
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
  const sections = [...props.sections.values()]
  const rows = sections.flatMap((section) => Array.from(section.rows.values()))
  const childPadding = {
    id: rows.reduce((len, rows) => Math.max(rows.id === null ? 0 : rows.id.length, len), props.padding.id),
    progress: rows.reduce((accum, row) => {
      return [...row.counters.values()].reduce((accum, counter, index) => {
        const len = Math.max(accum[index] ?? 0, `${counter.total?.size ?? counter.current.size}`.length)
        accum[index] = len
        return accum
      }, accum)
    }, [] as number[]),
  } as Padding
  return (
    <Box flexDirection="column">
      {props.id !== null ? <Row {...props} padding={props.padding} /> : []}
      {sections.map((section, index) => (
        <Section {...section} key={`${section.id}-${index}`} padding={childPadding} />
      ))}
    </Box>
  )
}

export const Terminal: React.FC<types.RenderState> = (props) => {
  if (!props.row) return <></>
  return <RowWithSections {...props.row} padding={{ id: 0, progress: [] }} />
}
