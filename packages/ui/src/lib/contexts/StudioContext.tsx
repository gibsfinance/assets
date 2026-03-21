import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Token, StudioAppearance, BadgeConfig, CodeFormat, CodeMode } from '../types'

interface StudioState {
  selectedToken: Token | null
  selectedChainId: string | null
  appearance: StudioAppearance
  badge: BadgeConfig
  codeFormat: CodeFormat
  codeMode: CodeMode
  resolutionOrder: string[] | null
  activeTab: 'browse' | 'configure'
}

interface StudioContextValue extends StudioState {
  selectToken: (token: Token) => void
  selectChain: (chainId: string) => void
  updateAppearance: (updates: Partial<StudioAppearance>) => void
  updateBadge: (updates: Partial<BadgeConfig>) => void
  setCodeFormat: (format: CodeFormat) => void
  setCodeMode: (mode: CodeMode) => void
  setResolutionOrder: (order: string[] | null) => void
  setActiveTab: (tab: 'browse' | 'configure') => void
  reset: () => void
}

const DEFAULT_APPEARANCE: StudioAppearance = {
  width: 64,
  height: 64,
  shape: 'circle',
  borderRadius: 8,
  padding: 0,
  shadow: 'none',
  backgroundColor: 'transparent',
}

const DEFAULT_BADGE: BadgeConfig = {
  enabled: false,
  angleDeg: 135,
  sizeRatio: 0.3,
  overlap: 0,
  ringEnabled: true,
  ringColor: '#09090b',
  ringThickness: 2,
}

const StudioCtx = createContext<StudioContextValue | null>(null)

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState>({
    selectedToken: null,
    selectedChainId: null,
    appearance: { ...DEFAULT_APPEARANCE },
    badge: { ...DEFAULT_BADGE },
    codeFormat: 'react',
    codeMode: 'snippet',
    resolutionOrder: null,
    activeTab: 'browse',
  })

  // Cross-page chain pre-selection: reads localStorage.selectedChainId on mount
  useEffect(() => {
    const storedChainId = localStorage.getItem('selectedChainId')
    if (storedChainId) {
      setState((s) => ({ ...s, selectedChainId: storedChainId }))
      localStorage.removeItem('selectedChainId')
    }
  }, [])

  const selectToken = useCallback((token: Token) => {
    setState((s) => ({
      ...s,
      selectedToken: token,
      selectedChainId: String(token.chainId),
      activeTab: 'configure',
    }))
  }, [])

  const selectChain = useCallback((chainId: string) => {
    setState((s) => ({ ...s, selectedChainId: chainId }))
  }, [])

  const updateAppearance = useCallback((updates: Partial<StudioAppearance>) => {
    setState((s) => ({ ...s, appearance: { ...s.appearance, ...updates } }))
  }, [])

  const updateBadge = useCallback((updates: Partial<BadgeConfig>) => {
    setState((s) => ({ ...s, badge: { ...s.badge, ...updates } }))
  }, [])

  const setCodeFormat = useCallback((codeFormat: CodeFormat) => {
    setState((s) => ({ ...s, codeFormat }))
  }, [])

  const setCodeMode = useCallback((codeMode: CodeMode) => {
    setState((s) => ({ ...s, codeMode }))
  }, [])

  const setResolutionOrder = useCallback((resolutionOrder: string[] | null) => {
    setState((s) => ({ ...s, resolutionOrder }))
  }, [])

  const setActiveTab = useCallback((activeTab: 'browse' | 'configure') => {
    setState((s) => ({ ...s, activeTab }))
  }, [])

  /** Resets appearance and badge config to defaults. Preserves selected token/chain. */
  const reset = useCallback(() => {
    setState((s) => ({
      ...s,
      appearance: { ...DEFAULT_APPEARANCE },
      badge: { ...DEFAULT_BADGE },
      codeFormat: 'react' as CodeFormat,
      codeMode: 'snippet' as CodeMode,
      resolutionOrder: null,
    }))
  }, [])

  return (
    <StudioCtx.Provider value={{
      ...state,
      selectToken,
      selectChain,
      updateAppearance,
      updateBadge,
      setCodeFormat,
      setCodeMode,
      setResolutionOrder,
      setActiveTab,
      reset,
    }}>
      {children}
    </StudioCtx.Provider>
  )
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioCtx)
  if (!ctx) throw new Error('useStudio must be used within StudioProvider')
  return ctx
}
