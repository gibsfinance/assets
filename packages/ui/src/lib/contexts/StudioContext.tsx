import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { Token, StudioAppearance, BadgeConfig, CodeFormat, CodeMode } from '../types'

interface StudioState {
  selectedToken: Token | null
  selectedChainId: string | null
  appearance: StudioAppearance
  badge: BadgeConfig
  codeFormat: CodeFormat
  codeMode: CodeMode
  resolutionOrder: string[] | null
  activeTab: 'browse' | 'configure' | 'editor'
}

interface StudioContextValue extends StudioState {
  selectToken: (token: Token) => void
  selectChain: (chainId: string | null) => void
  updateAppearance: (updates: Partial<StudioAppearance>) => void
  updateBadge: (updates: Partial<BadgeConfig>) => void
  setCodeFormat: (format: CodeFormat) => void
  setCodeMode: (mode: CodeMode) => void
  setResolutionOrder: (order: string[] | null) => void
  setActiveTab: (tab: 'browse' | 'configure' | 'editor') => void
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
  badgeShape: 'circle',
  badgePadding: 0,
  badgeBackground: 'transparent',
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'gib-studio-state'

/** Only visual preferences are persisted — navigational state lives in the URL */
interface PersistedPrefs {
  appearance: StudioAppearance
  badge: BadgeConfig
  codeFormat: CodeFormat
  codeMode: CodeMode
  resolutionOrder: string[] | null
}

function loadPersistedPrefs(): Partial<PersistedPrefs> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function savePersistedPrefs(state: StudioState): void {
  const persisted: PersistedPrefs = {
    appearance: state.appearance,
    badge: state.badge,
    codeFormat: state.codeFormat,
    codeMode: state.codeMode,
    resolutionOrder: state.resolutionOrder,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    // localStorage full or unavailable
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const StudioCtx = createContext<StudioContextValue | null>(null)

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState>(() => {
    const prefs = loadPersistedPrefs()
    return {
      selectedToken: null,
      selectedChainId: null,
      appearance: { ...DEFAULT_APPEARANCE, ...prefs.appearance },
      badge: { ...DEFAULT_BADGE, ...prefs.badge },
      codeFormat: prefs.codeFormat ?? 'sdk',
      codeMode: prefs.codeMode ?? 'snippet',
      resolutionOrder: prefs.resolutionOrder ?? null,
      activeTab: 'browse',
    }
  })

  // Persist preferences (debounced)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => savePersistedPrefs(state), 300)
    return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current) }
  }, [state])

  // Cross-page chain pre-selection from Home page network grid
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

  const selectChain = useCallback((chainId: string | null) => {
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

  const setActiveTab = useCallback((activeTab: 'browse' | 'configure' | 'editor') => {
    setState((s) => ({ ...s, activeTab }))
  }, [])

  const reset = useCallback(() => {
    setState((s) => ({
      ...s,
      appearance: { ...DEFAULT_APPEARANCE },
      badge: { ...DEFAULT_BADGE },
      codeFormat: 'sdk' as CodeFormat,
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
