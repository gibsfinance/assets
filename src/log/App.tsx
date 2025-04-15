import * as ink from 'ink'
import { Terminal } from './Terminal'
import * as types from './types'
import _ from 'lodash'
import { terminalRowTypes, type TerminalSectionProxy } from './types'

let terminal: ReturnType<typeof ink.render> | null = null
let isRunning = true
const globalDefaultLimit = 4

// Handle Ctrl+C gracefully
// process.on('SIGINT', () => {
//   stop('Stopped by user')
// })

// export const stop = (message: string) => {
//   isRunning = false
//   if (!terminal) {
//     return
//   }
//   globalInfo.finalNote = message
//   globalInfo.terminated = true
//   rerender()
//   setTimeout(() => {
//     unmount()
//   }, 100)
// }

// export const reset = () => {
//   globalInfo.sections.clear()
//   globalInfo.terminated = false
//   globalInfo.finalNote = null
//   rerender()
// }

// export const unmount = () => {
//   if (terminal) {
//     terminal.unmount()
//     terminal = null
//   }
// }

const globalInfo = {
  terminated: false,
  finalNote: null,
  row: null,
} as types.RenderState

export const getGlobalInfo = () => ({
  ...globalInfo,
})

const doRerender = _.throttle(() => {
  if (!terminal) {
    terminal = ink.render(<Terminal {...globalInfo} />)
  } else {
    terminal.rerender(<Terminal {...globalInfo} />)
  }
}, 200)

export const rerender = () => {
  if (!isRunning) return
  doRerender()
}

export const createTerminal = () => {
  if (globalInfo.row) {
    throw new Error('unable to issue the same global key twice')
  }

  const row = {
    id: null,
    type: 'summary',
    lastUpdated: new Date(),
  } as types.TerminalRow
  globalInfo.row = row
  return readOnlyRow(globalInfo.row)
}

export const readOnlyRow = (row: types.TerminalRow) => {
  return {
    get(id: string) {
      const section = row.sections?.get(id)
      if (!section) {
        return null
      }
      return readOnlySection(row, section)
    },
    update(updates: Partial<types.TerminalRow>) {
      for (const [k, v] of Object.entries(updates)) {
        // @ts-expect-error
        row[k] = v
      }
      rerender()
    },
    createCounter(key: types.TerminalCounterType, total?: number) {
      const counters = (row.counters = row.counters ?? new Map())
      counters.set(key, {
        current: 0,
        total: total ?? null,
      })
      rerender()
    },
    incrementTotal(key: types.TerminalCounterType | string, amount = 1) {
      const counter = row.counters?.get(key)
      if (!counter) {
        throw new Error('counter not found')
      }
      counter.total = (counter.total ?? 0) + amount
      rerender()
    },
    increment(key: types.TerminalCounterType | string, amount = 1) {
      let counter = row.counters?.get(key)
      if (!counter) {
        counter = {
          current: 0,
          total: null,
        }
      }
      const current = counter.current
      row.counters.set(key, {
        ...counter,
        current: current + amount,
      })
      rerender()
      return current
    },
    decrement(key: types.TerminalCounterType | string) {
      return this.increment(key, -1)
    },
    removeCounter(key: types.TerminalCounterType | string) {
      row.counters?.delete(key)
      rerender()
    },
    complete() {
      row.type = terminalRowTypes.COMPLETE
      rerender()
    },
    remove(key: string) {
      row.sections?.delete(key)
      rerender()
    },
    issue(id: string, limit: number | null = null) {
      const sections = (row.sections = row.sections ?? new Map())
      const section = {
        id,
        limit: limit ?? globalDefaultLimit,
        rows: new Map(),
      } as types.Section
      const existing = sections.get(id)
      if (existing) {
        console.log(id)
        throw new Error('duplicate key')
      }
      sections.set(id, section)
      rerender()
      return readOnlySection(row, section)
    },
  }
}

export const readOnlySection = (parent: types.TerminalRow, section: types.Section): TerminalSectionProxy => {
  return {
    get(id: string) {
      const s = section.rows?.get(id)
      if (!s) {
        return null
      }
      return readOnlyRow(s)
    },
    task(id: string, row: types.TerminalTask) {
      const rows = (section.rows = section.rows ?? new Map())
      const r = {
        isTask: true,
        lastUpdated: new Date(),
        counters: new Map(),
        ...row,
      }
      rows.set(id, r)
      const roParent = readOnlyRow(parent)
      roParent.increment('tasks')
      rerender()
      return {
        ...readOnlyRow(r),
        unmount: () => {
          const prevVal = roParent.decrement('tasks')
          if (prevVal === 1) {
            roParent.removeCounter('tasks')
          }
          rows.delete(id)
          rerender()
        },
      }
    },
    issue(props) {
      const row = {
        ...props,
        lastUpdated: new Date(),
        counters: new Map(),
      } as types.TerminalRow
      const rows = (section.rows = section.rows ?? new Map())
      const existing = rows.get(props.id)
      if (existing) {
        throw new Error(`duplicated row ${props.id}`)
      }
      rows.set(props.id, row)
      rerender()
      return readOnlyRow(row)
    },
    removeRow(key: string) {
      section.rows?.delete(key)
      rerender()
    },
  }
}
