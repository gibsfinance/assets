export const terminalRowTypes = {
  SUMMARY: 'summary',
  SETUP: 'setup',
  STORAGE: 'storage',
  COMPLETE: 'complete',
} as const
export type TerminalRowTypes = typeof terminalRowTypes
export type TerminalRowTypeKeys = keyof TerminalRowTypes
export type TerminalRowType = TerminalRowTypes[keyof TerminalRowTypes]
export const terminalCounterTypes = {
  PROVIDER: 'provider',
  NETWORK: 'network',
  TOKEN: 'token',
} as const
export type TerminalCounterTypes = typeof terminalCounterTypes
export type TerminalCounterTypeKeys = keyof TerminalCounterTypes
export type TerminalCounterType = TerminalCounterTypes[keyof TerminalCounterTypes]
export const terminalLogTypes = {
  PROG: 'prog',
  WARN: 'warn',
  EROR: 'eror',
  INFO: 'info',
  DBUG: 'dbug',
  TRAC: 'trac',
} as const
export type TerminalLogTypes = typeof terminalLogTypes
export type TerminalLogTypeKeys = keyof TerminalLogTypes
export type TerminalLogType = TerminalLogTypes[keyof TerminalLogTypes]
export type KV = Record<string, any>
export type Counter = { current: Set<string>; total: number | null }
export type Progress = Counter & { total: number }
export type Sections = Map<string, Section>
export type TerminalRows = Map<string, TerminalRow>
export type TerminalRow = {
  type: TerminalRowType
  id: string | null
  lastUpdated: Date
  counters: Map<TerminalCounterType | string, Counter>
  sections: Sections
  hide?: boolean
  isTask?: boolean
  message?: string
  kv?: KV
}
export type Section = {
  id: string
  rows: TerminalRows
  limit: number
  hide?: boolean
}
export type RenderState = {
  terminated: boolean
  finalNote: null | string
  row: TerminalRow | null
}
export type TerminalRowProxy = {
  update: (updates: Partial<TerminalRow>) => void
  createCounter: (key: TerminalCounterType | string, stayLocal?: boolean) => void
  incrementTotal: (key: TerminalCounterType | string, amount?: number) => void
  increment: (key: TerminalCounterType | string, ids: Set<string> | string, decrement?: boolean) => Set<string>
  decrement: (key: TerminalCounterType | string, ids: Set<string> | string) => Set<string>
  removeCounter: (key: TerminalCounterType | string) => void
  complete: () => void
  remove: (key: string) => void
  hideSection: (key: string) => void
  hide: () => void
  issue: (id: string, limit?: number) => TerminalSectionProxy
  get: (key: string) => TerminalSectionProxy | null
  hasCounter: (key: TerminalCounterType | string) => boolean
}
export type TerminalSectionProxy = {
  get: (id: string) => TerminalRowProxy | null
  /**
   * create a task that will be displayed in the terminal
   * @param id a unique identifier for the task
   * @param row the row metadata for the task
   * @returns a proxy for the task
   */
  task: (id: string, row: TerminalTask) => TerminalRowProxy & { unmount: () => void }
  /**
   * create a row that to be displayed in the terminal
   * @param props the row metadata for the row
   * @returns a proxy for the row
   */
  issue: (props: Omit<TerminalTask & { id: string }, 'sections'>) => TerminalRowProxy
  removeRow: (key: string) => void
  increment: (key: TerminalCounterType | string, ids: Set<string> | string, decrement?: boolean) => Set<string>
  decrement: (key: TerminalCounterType | string, ids: Set<string> | string) => Set<string>
  incrementTotal: (key: TerminalCounterType | string, num?: number) => void
  createCounter: (key: TerminalCounterType | string, stayLocal?: boolean) => void
}
export type TerminalTask = Omit<TerminalRow, 'isTask' | 'lastUpdated' | 'counters'>
