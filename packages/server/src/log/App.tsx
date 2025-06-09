import React from 'react'
import * as ink from 'ink'
import _ from 'lodash'
import { Terminal } from './Terminal'
import * as types from './types'
import { terminalRowTypes } from './types'
import { controller } from '../utils'
import { log } from '../logger'

let terminal: ReturnType<typeof ink.render> | null = null
let isRunning = true
let isMunging = 0
const globalDefaultLimit = 4

let doesRender = true

export const setDoesRender = (doesRenderArg: boolean) => {
  doesRender = doesRenderArg
}

export const doLog = (fn: () => void) => {
  if (doesRender) return
  fn()
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  stop('Stopped by user')
})

export const stop = (message: string) => {
  isRunning = false
  if (!terminal) {
    return
  }
  globalInfo.finalNote = message
  globalInfo.terminated = true
  controller.abort()
  rerenderAfter(() => {
    const markUndefinedStatus = (row: types.TerminalRow) => {
      if (row.type !== terminalRowTypes.COMPLETE) {
        row.type = terminalRowTypes['-']
      }
      for (const section of row.sections.values()) {
        for (const row of section.rows.values()) {
          markUndefinedStatus(row)
        }
      }
    }
    if (globalInfo.row) {
      markUndefinedStatus(globalInfo.row)
    }
  })
}

const globalInfo = {
  terminated: false,
  finalNote: null,
  row: null,
} as types.RenderState

const counterKeys = new Set(Object.values(types.terminalCounterTypes))

export const getGlobalInfo = () => ({
  ...globalInfo,
})

export const forceRerender = () => {
  if (!doesRender) return
  if (!terminal) {
    terminal = ink.render(<Terminal {...globalInfo} />)
  } else {
    terminal.rerender(<Terminal {...globalInfo} />)
  }
}

const doRerender = _.throttle(forceRerender, 200)

export const rerender = () => {
  if (!isRunning) return
  if (isMunging) return
  doRerender()
  isRunning = !globalInfo.terminated
}

export const rerenderAfter = <T extends unknown>(fn: () => T) => {
  isMunging++
  const res = fn()
  isMunging--
  rerender()
  return res
}

export const createTerminal = () => {
  if (globalInfo.row) {
    throw new Error('unable to issue the same global key twice')
  }

  const row = {
    id: null,
    type: 'summary',
    lastUpdated: new Date(),
    counters: new Map(),
    sections: new Map(),
  } as types.TerminalRow
  globalInfo.row = row
  return readOnlyRow(null, globalInfo.row)
}

export const logCounter = (key: types.TerminalCounterType | string, action: string, counter?: types.Counter) => {
  doLog(() => {
    log(`${action} counter %o`, _.omitBy({
      key,
      current: counter?.current?.size,
      total: counter?.total?.size,
    }, _.isNil))
  })
}

export const readOnlyRow = (parent: types.TerminalSectionProxy | null, row: types.TerminalRow) => {
  return {
    get(id: string) {
      const section = row.sections?.get(id)
      if (!section) {
        return null
      }
      return readOnlySection(readOnlyRow(parent, row), section)
    },
    update(updates: Partial<types.TerminalRow>) {
      rerenderAfter(() => {
        for (const [k, v] of Object.entries(updates)) {
          // @ts-expect-error
          row[k] = v
        }
        doLog(() => {
          log(`updating row id=%o, kv=%o`, row.id, row.kv)
        })
      })
    },
    createCounter(key: types.TerminalCounterType | string, stayLocal?: boolean) {
      rerenderAfter(() => {
        if (!stayLocal) parent?.createCounter(key, stayLocal)
        const counters = (row.counters = row.counters ?? new Map())
        const create = (key: types.TerminalCounterType) => {
          if (counters.has(key)) {
            return
          }
          counters.set(key, {
            current: new Set(),
            total: null,
          })
          logCounter(key, 'creating', counters.get(key)!)
        }
        let createAter = false
        for (const k of counterKeys.values()) {
          if (!createAter) {
            if (k !== key) continue
          }
          create(k)
          createAter = true
        }
        const exists = counters.get(key)
        if (exists) {
          return exists
        }
        logCounter(key, 'creating', counters.get(key)!)
        counters.set(key, {
          current: new Set(),
          total: null,
        })
      })
    },
    hasCounter(key: types.TerminalCounterType | string) {
      return row.counters?.has(key)
    },
    updateCounter(key: types.TerminalCounterType | string, updates: Partial<types.Counter>) {
      rerenderAfter(() => {
        const counter = row.counters?.get(key)
        if (!counter) {
          throw new Error('counter not found')
        }
        const updated = { ...counter, ...updates }
        row.counters.set(key, updated)
        logCounter(key, 'updating', updated)
      })
    },
    incrementTotal(key: types.TerminalCounterType | string, expected: string | Set<string>) {
      rerenderAfter(() => {
        const list = typeof expected === 'string' ? new Set([expected]) : expected
        const counter = row.counters?.get(key)
        if (!counter) {
          throw new Error('counter not found')
        }
        parent?.incrementTotal(key, list)
        counter.total = (counter.total ?? new Set()).union(list)
        // logCounter(key, 'incrementing total', counter)
      })
    },
    increment(key: types.TerminalCounterType | string, ids: Set<string> | string, decrement = false) {
      return rerenderAfter(() => {
        if (!row.counters.has(key)) {
          this.createCounter(key)
        }
        const counter = row.counters.get(key)
        if (!counter) {
          throw new Error('counter not found')
        }
        const current = counter.current
        parent?.increment(key, ids, decrement)
        const idSet = typeof ids === 'string' ? new Set([ids]) : ids
        const updatedSet = decrement ? current.difference(idSet) : current.union(idSet)
        row.counters.set(key, {
          ...counter,
          current: updatedSet,
        })
        // logCounter(key, 'incrementing', row.counters.get(key)!)
        return updatedSet
      })
    },
    decrement(key: types.TerminalCounterType | string, ids: Set<string> | string) {
      return this.increment(key, ids, true)
    },
    removeCounter(key: types.TerminalCounterType | string) {
      rerenderAfter(() => {
        row.counters?.delete(key)
        logCounter(key, 'removing')
      })
    },
    hide() {
      rerenderAfter(() => {
        row.hide = true
        doLog(() => {
          log(`hiding row key=%o`, row.id)
        })
      })
    },
    hideSection(key: string) {
      rerenderAfter(() => {
        const section = row.sections.get(key)
        if (!section) {
          return
        }
        section.hide = true
        doLog(() => {
          log(`hiding section key=%o`, key)
        })
      })
    },
    complete() {
      if (globalInfo.terminated) {
        return
      }
      rerenderAfter(() => {
        row.type = terminalRowTypes.COMPLETE
        doLog(() => {
          log(`completing row key=%o kv=%o`, row.id, row.kv)
        })
      })
    },
    remove(key: string) {
      rerenderAfter(() => {
        row.sections?.delete(key)
        doLog(() => {
          log(`removing section key=%o`, key)
        })
      })
    },
    issue(id: string, limit: number | null = null) {
      return rerenderAfter(() => {
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
        return readOnlySection(readOnlyRow(parent, row), section)
      })
    },
  } as types.TerminalRowProxy
}

export const readOnlySection = (parent: types.TerminalRowProxy, section: types.Section): types.TerminalSectionProxy => {
  return {
    get(id: string) {
      const s = section.rows.get(id)
      if (!s) {
        return null
      }
      return readOnlyRow(readOnlySection(parent, section), s)
    },
    task(id: string, row: Omit<types.TerminalTask, 'sections'>) {
      return rerenderAfter(() => {
        const r = {
          isTask: true,
          lastUpdated: new Date(),
          counters: new Map(),
          sections: new Map(),
          ...row,
        }
        section.rows.set(id, r)
        const ro = readOnlyRow(readOnlySection(parent, section), r)
        parent.increment('tasks', new Set([id]))
        return {
          ...ro,
          unmount: () => {
            const nextVal = parent.increment('tasks', new Set([id]), true)
            if (nextVal.size === 0) {
              parent.removeCounter('tasks')
            }
            section.rows.delete(id)
            // assume this is outside of a rerender context - call directly
            rerender()
          },
        }
      })
    },
    issue(props) {
      return rerenderAfter(() => {
        const row = {
          ...props,
          lastUpdated: new Date(),
          counters: new Map(),
          sections: new Map(),
        } as types.TerminalRow
        const existing = section.rows.get(props.id)
        if (existing) {
          throw new Error(`duplicated row ${props.id}`)
        }
        section.rows.set(props.id, row)
        return readOnlyRow(readOnlySection(parent, section), row)
      })
    },
    removeRow(key: string) {
      return rerenderAfter(() => {
        section.rows.delete(key)
      })
    },
    increment(key: types.TerminalCounterType | string, ids: Set<string> | string, decrement?: boolean) {
      return !parent.hasCounter(key) ? 0 : parent.increment(key, ids, decrement)
    },
    incrementTotal(key: types.TerminalCounterType | string, num: Set<string> | string) {
      if (parent.hasCounter(key)) {
        parent.incrementTotal(key, num)
      }
    },
    decrement(key: types.TerminalCounterType | string, ids: Set<string> | string) {
      if (parent.hasCounter(key)) parent.decrement(key, ids)
    },
    createCounter(key: types.TerminalCounterType | string, stayLocal?: boolean) {
      if (stayLocal) return
      return parent.createCounter(key, stayLocal)
    },
    updateCounter(key: types.TerminalCounterType | string, updates: Partial<types.Counter>) {
      if (parent.hasCounter(key)) {
        parent.updateCounter(key, updates)
      }
    },
  } as types.TerminalSectionProxy
}
