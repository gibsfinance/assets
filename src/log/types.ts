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
  TOKEN: 'token',
  NETWORK: 'network',
  PROVIDER: 'provider',
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
export type Counter = { current: number; total: number | null }
export type Progress = Counter & { total: number }
export type Sections = Map<string, Section>
export type TerminalRows = Map<string, TerminalRow>
export type TerminalRow = {
  type: TerminalRowType
  isTask?: boolean
  id: string | null
  lastUpdated: Date
  counters: Map<TerminalCounterType | string, Counter>
  message?: string
  sections?: Sections
  kv?: KV
}
export type Section = {
  id: string
  rows: TerminalRows
  limit: number
}
export type RenderState = {
  terminated: boolean
  finalNote: null | string
  row: TerminalRow | null
}
export type TerminalRowProxy = {
  update: (updates: Partial<TerminalRow>) => void
  createCounter: (key: TerminalCounterType, total?: number) => void
  incrementTotal: (key: TerminalCounterType | string, amount?: number) => void
  increment: (key: TerminalCounterType | string, amount?: number) => number
  decrement: (key: TerminalCounterType | string) => void
  removeCounter: (key: TerminalCounterType | string) => void
  complete: () => void
  remove: (key: string) => void
  issue: (id: string, limit?: number) => TerminalSectionProxy
  get: (key: string) => TerminalSectionProxy | null
}
export type TerminalSectionProxy = {
  get: (id: string) => TerminalRowProxy | null
  task: (id: string, row: TerminalTask) => TerminalRowProxy & { unmount: () => void }
  issue: (props: TerminalTask & { id: string }) => TerminalRowProxy
  removeRow: (key: string) => void
}
export type TerminalTask = Omit<TerminalRow, 'isTask' | 'lastUpdated' | 'counters'>
