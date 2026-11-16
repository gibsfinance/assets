import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { createClient, type GibClient, type GibClientOptions } from '@gibs/sdk'

const GibContext = createContext<GibClient | null>(null)

export interface GibProviderProps extends GibClientOptions {
  children: ReactNode
}

/**
 * Provides a Gib.Show client to all child components.
 *
 * @example
 * ```tsx
 * <GibProvider staging>
 *   <App />
 * </GibProvider>
 * ```
 */
export function GibProvider({ children, ...options }: GibProviderProps) {
  const client = useMemo(() => createClient(options), [options.baseUrl, options.staging])
  return <GibContext.Provider value={client}>{children}</GibContext.Provider>
}

/**
 * The client from context, or null outside a provider. For components that also work without one and
 * fall back to a base address they are given.
 */
export function useOptionalGib(): GibClient | null {
  return useContext(GibContext)
}

/** Access the Gib.Show client from context */
export function useGib(): GibClient {
  const ctx = useContext(GibContext)
  if (!ctx) throw new Error('useGib must be used within <GibProvider>')
  return ctx
}
