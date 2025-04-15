import * as ink from 'ink'
import { Terminal } from './Terminal'
import * as types from './types'
import { counterTypes } from './types'
import _ from 'lodash'

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
  } as types.Row
  globalInfo.row = row
  return readOnlyRow(globalInfo.row)
}

export const readOnlyRow = (row: types.Row) => {
  return {
    get(id: string) {
      const section = row.sections?.get(id)
      if (!section) {
        throw new Error('section not found')
      }
      return readOnlySection(row, section)
    },
    update(updates: Partial<types.Row>) {
      for (const [k, v] of Object.entries(updates)) {
        // @ts-expect-error
        row[k] = v
      }
      rerender()
    },
    createCounter(key: types.CounterType, total?: number) {
      const counters = (row.counters = row.counters ?? new Map())
      counters.set(key, {
        current: 0,
        total: total ?? null,
      })
      rerender()
    },
    increment(key: types.CounterType | string, amount = 1) {
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
    decrement(key: types.CounterType | string) {
      return this.increment(key, -1)
    },
    removeCounter(key: types.CounterType | string) {
      row.counters?.delete(key)
      rerender()
    },
    complete() {
      row.type = types.rowTypes.COMPLETE
      rerender()
    },
    remove(key: string) {
      row.sections?.delete(key)
      rerender()
    },
    issue(id: string, limit: number = Infinity) {
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

export const readOnlySection = (parent: types.Row, section: types.Section) => {
  return {
    get(id: string) {
      const s = section.rows?.get(id)
      if (!s) {
        throw new Error('row not found')
      }
      return readOnlyRow(s)
    },
    task(id: string, row: Omit<types.Row, 'isTask' | 'lastUpdated' | 'counters'>) {
      const rows = (section.rows = section.rows ?? new Map())
      const r = {
        isTask: true,
        lastUpdated: new Date(),
        counters: new Map(),
        ...row,
      }
      rows.set(id, r)
      readOnlyRow(parent).increment('tasks')
      rerender()
      return {
        ...readOnlyRow(r),
        unmount: () => {
          const roParent = readOnlyRow(parent)
          const prevVal = roParent.decrement('tasks')
          if (prevVal === 1) {
            roParent.removeCounter('tasks')
          }
          rows.delete(id)
          rerender()
        },
      }
    },
    issue<T extends types.RowType>(props: { type: T; id: string }) {
      const row = {
        ...props,
        lastUpdated: new Date(),
        counters: new Map(),
      } as types.Row
      const rows = (section.rows = section.rows ?? new Map())
      const existing = rows.get(props.id)
      if (existing) {
        throw new Error('duplicated row')
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
