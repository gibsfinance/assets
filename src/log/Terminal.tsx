import { Box, Text } from 'ink'
import React from 'react'
import type * as types from './types'
import _ from 'lodash'
import { logTypes } from './types'

const emoji = {
  row: {
    summary: '🔍',
    setup: '🏗️',
    storage: '💾',
    complete: '✨',
  } as Record<types.RowType, string>,
  log: {
    prog: '⚡',
    warn: '⚠️',
    eror: '💥',
  } as Record<types.LogType, string>,
  counter: {
    token: '🪙',
    network: '💻',
    provider: '🎖️',
  } as Record<types.CounterType, string>,
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
  const toRender = [...props.rows.values()].slice(-props.limit)
  // console.log(toRender.length, props.rows.size, props.limit)
  return (
    <Box display="flex" flexDirection="column">
      {toRender.map((row, index) => (
        <RowWithSections {...row} key={`${props.id}-${index}`} />
      ))}
    </Box>
  )
}

export const Progress: React.FC<
  types.Counter & { total: number; progress: number; id: types.CounterType | string; isTask?: boolean }
> = (props) => {
  const progress = props.progress || undefined
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
      <Text dimColor={props.isTask}>{emoji.counter[props.id as types.CounterType] ?? props.id}</Text>
    </Box>
  )
}
export const Counter: React.FC<types.Counter & { id: types.CounterType | string; isTask?: boolean }> = (props) => {
  return (
    <Box display="flex" flexDirection="row">
      <Text dimColor={props.isTask}>{emoji.counter[props.id as types.CounterType] ?? props.id}</Text>
      <Text dimColor={props.isTask}>=</Text>
      <Box display="flex" justifyContent="flex-end">
        <Text dimColor={props.isTask}>{props.current}</Text>
      </Box>
    </Box>
  )
}

export const Row: React.FC<types.Row & { padding: Padding }> = (props) => {
  const kvEntries = Object.entries(props.kv ?? {})
  const [counterEntries, logEntries] = _.partition(
    [...props.counters.entries()],
    ([key]) => !logTypes[key.toUpperCase() as unknown as keyof types.LogTypes],
  )
  return (
    <Box display="flex" flexDirection="row" gap={1}>
      <Box width={2} display="flex" justifyContent="flex-end">
        <Text dimColor={props.isTask}>{emoji.row[props.type]}</Text>
      </Box>
      <Box minWidth={props.padding.id || undefined} display="flex" justifyContent="flex-end">
        <Text dimColor={props.isTask}>{props.id}</Text>
      </Box>
      {counterEntries.length ? (
        <Box display="flex" flexDirection="row" justifyContent="flex-start" gap={2}>
          {counterEntries.map(([key, counter], index) => {
            const progress = props.padding.progress[index]
            const k = `${key}-${index}`
            return counter.total ? (
              <Progress {...(counter as types.Progress)} id={key} progress={progress} key={k} isTask={props.isTask} />
            ) : (
              <Counter {...counter} id={key} key={k} isTask={props.isTask} />
            )
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

export const RowWithSections: React.FC<types.Row> = (props) => {
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
