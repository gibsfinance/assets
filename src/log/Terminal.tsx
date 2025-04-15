import { Box, Text } from 'ink'
import React from 'react'
import _ from 'lodash'
import * as types from './types'

const emoji = {
  row: {
    summary: '🔍',
    setup: '🏗️',
    storage: '💾',
    complete: '🎉',
  } as Record<types.TerminalRowType, string>,
  log: {
    prog: '⚡',
    warn: '⚠️',
    eror: '💥',
  } as Record<types.TerminalLogType, string>,
  counter: {
    token: '🪙',
    network: '💻',
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
  const toRender = [...props.rows.values()].slice(-props.limit).sort((a, b) => {
    const aIsComplete = a.type === types.terminalRowTypes.COMPLETE
    const bIsComplete = b.type === types.terminalRowTypes.COMPLETE
    if (aIsComplete && !bIsComplete) return 1
    if (!aIsComplete && bIsComplete) return -1
    return 0
  })
  return (
    <Box display="flex" flexDirection="column">
      {toRender.map((row, index) => (
        <RowWithSections {...row} key={`${props.id}-${index}`} />
      ))}
    </Box>
  )
}

export const Progress: React.FC<
  types.Counter & { total: number; progress: number; id: types.TerminalCounterType | string; isTask?: boolean }
> = (props) => {
  const progress = props.progress || undefined
  const emojiInput = emoji.counter[props.id as types.TerminalCounterType]
  const width = emojiInput ? 2 : undefined
  return (
    <Box width={progress ? progress * 2 + 4 : undefined} display="flex" justifyContent="flex-end">
      <Box width={progress} display="flex" justifyContent="flex-end">
        <Text dimColor={props.isTask}>{props.current}</Text>
      </Box>
      <Text dimColor={props.isTask}>/</Text>
      <Box width={progress} display="flex" justifyContent="flex-start">
        <Text dimColor={props.isTask}>{props.total}</Text>
      </Box>
      <Text dimColor={props.isTask}>=</Text>
      <Box width={width} display="flex" justifyContent="flex-start" marginRight={1}>
        <Text dimColor={props.isTask}>{emojiInput ?? props.id}</Text>
      </Box>
    </Box>
  )
}
export const Counter: React.FC<types.Counter & { id: types.TerminalCounterType | string; isTask?: boolean }> = (
  props,
) => {
  return (
    <Box display="flex" flexDirection="row">
      <Text dimColor={props.isTask}>{emoji.counter[props.id as types.TerminalCounterType] ?? props.id}</Text>
      <Text dimColor={props.isTask}>=</Text>
      <Box display="flex" justifyContent="flex-end">
        <Text dimColor={props.isTask}>{props.current}</Text>
      </Box>
    </Box>
  )
}

export const Row: React.FC<types.TerminalRow & { padding: Padding }> = (props) => {
  const kvEntries = Object.entries(props.kv ?? {})
  const [logEntries, otherEntries] = _.partition(
    [...props.counters.entries()],
    ([key]) => !!types.terminalLogTypes[key.toUpperCase() as unknown as types.TerminalLogTypeKeys],
  )
  const [progressEntries, counterEntries] = _.partition(
    otherEntries,
    ([key]) => !!types.terminalCounterTypes[key.toUpperCase() as unknown as types.TerminalCounterTypeKeys],
  )
  return (
    <Box display="flex" flexDirection="row" gap={1}>
      <Box width={2} display="flex" justifyContent="flex-end">
        {props.isTask ? null : <Text dimColor={props.isTask}>{emoji.row[props.type]}</Text>}
      </Box>
      <Box minWidth={props.padding.id || undefined} display="flex" justifyContent="flex-end">
        <Text dimColor={props.isTask}>{props.id}</Text>
      </Box>
      {progressEntries.length ? (
        <Box display="flex" flexDirection="row" justifyContent="flex-start" gap={2}>
          {progressEntries.map(([key, counter], index) => {
            const progress = props.padding.progress[index]
            return (
              <Progress {...(counter as types.Progress)} id={key} progress={progress} key={key} isTask={props.isTask} />
            )
          })}
        </Box>
      ) : null}
      {counterEntries.length ? (
        <Box display="flex" flexDirection="row" justifyContent="flex-start" gap={2}>
          {counterEntries.map(([key, counter]) => {
            return <Counter {...counter} id={key} key={key} isTask={props.isTask} />
          })}
        </Box>
      ) : null}
      {props.message ? (
        <Box display="flex" justifyContent="flex-start">
          <Text dimColor={props.isTask}>{props.message}</Text>
        </Box>
      ) : null}
      {logEntries.length
        ? logEntries.map(([k, counter]) => {
            return <Counter {...counter} id={k} key={k} isTask={props.isTask} />
          })
        : null}
      {kvEntries.length ? (
        <Box display="flex" justifyContent="flex-start" flexDirection="row" gap={1}>
          <Text dimColor={props.isTask}>{kvEntries.map(([k, v]) => `${k}=${v}`).join(' ')}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

export const RowWithSections: React.FC<types.TerminalRow> = (props) => {
  const sections = props.sections ? [...props.sections.values()] : []
  const rows = sections.flatMap((section) => Array.from(section.rows.values()))
  const padding = {
    id: sections.reduce((len, section) => Math.max(section.id.length, len), 0),
    progress: rows.reduce((accum, row) => {
      return [...row.counters.values()].reduce((accum, counter, index) => {
        const len = Math.max(accum[index], `${counter.total ?? counter.current}`.length)
        accum[index] = len
        return accum
      }, accum)
    }, [] as number[]),
  } as Padding
  return (
    <Box flexDirection="column">
      {props.id ? <Row {...props} padding={padding} /> : []}
      {sections.map((section, index) => (
        <Section {...section} key={`${section.id}-${index}`} padding={padding} />
      ))}
    </Box>
  )
}

export const Terminal: React.FC<types.RenderState> = (props) => {
  if (!props.row) return <></>
  return <RowWithSections {...props.row} />
}
