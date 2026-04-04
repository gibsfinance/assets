import { createContext, useContext, type ReactNode } from 'react'
import { useMetrics, type MetricsHookResult } from '../hooks/useMetrics'

const MetricsContext = createContext<MetricsHookResult | null>(null)

export function MetricsProvider({ children }: { children: ReactNode }) {
  const metricsHook = useMetrics()
  return <MetricsContext.Provider value={metricsHook}>{children}</MetricsContext.Provider>
}

export function useMetricsContext(): MetricsHookResult {
  const ctx = useContext(MetricsContext)
  if (!ctx) throw new Error('useMetricsContext must be used within MetricsProvider')
  return ctx
}
