export const rowTypes = {
  SUMMARY: 'summary',
  SETUP: 'setup',
  STORAGE: 'storage',
  COMPLETE: 'complete',
} as const
export type RowTypes = typeof rowTypes
export type RowType = RowTypes[keyof RowTypes]
export const counterTypes = {
  TOKEN: 'token',
  NETWORK: 'network',
  PROVIDER: 'provider',
} as const
export type CounterTypes = typeof counterTypes
export type CounterType = CounterTypes[keyof CounterTypes]
export const logTypes = {
  PROG: 'prog',
  WARN: 'warn',
  EROR: 'eror',
} as const
export type LogTypes = typeof logTypes
export type LogType = LogTypes[keyof LogTypes]
export type KV = Record<string, any>
export type Counter = { current: number; total: number | null }
export type Progress = Counter & { total: number }
export type Sections = Map<string, Section>
export type Rows = Map<string, Row>
export type Row = {
  type: RowType
  isTask?: boolean
  id: string | null
  lastUpdated: Date
  counters: Map<CounterType | string, Counter>
  message?: string
  sections?: Sections
  kv?: KV
}
export type Section = {
  id: string
  rows: Rows
  limit: number
}
export type RenderState = {
  terminated: boolean
  finalNote: null | string
  row: Row | null
}
