import { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import BottomDrawer from '../components/BottomDrawer'
import Image from '../components/Image'
import ListEditor from '../components/ListEditor'
import StudioBrowser from '../components/StudioBrowser'
import StudioConfigurator from '../components/StudioConfigurator'
import TokenDetailModal from '../components/TokenDetailModal'
import { ThemeToggle } from '../components/ThemeToggle'
import { useListEditor } from '../contexts/ListEditorContext'
import { useStudio } from '../contexts/StudioContext'
import { useSettings } from '../contexts/SettingsContext'
import { getApiUrl } from '../utils'
import type { Token } from '../types'

/**
 * Studio page — URL hash params drive navigational state:
 *   ?chain=1           — browsing Ethereum
 *   ?chain=1&token=0x  — token selected for configurator
 *   ?editor=new        — list editor creation menu
 *   ?editor=<listId>   — editing a specific list
 *
 * Appearance/badge/code preferences stay in localStorage (via StudioContext).
 */
export default function Studio() {
  const { selectedToken, selectedChainId, selectToken, selectChain } = useStudio()
  const { showTestnets, setShowTestnets } = useSettings()
  const { isOpen: editorOpen, activeList, openNewEditor, openEditor, closeEditor } = useListEditor()
  const [inspectToken, setInspectToken] = useState<Token | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // ---------------------------------------------------------------------------
  // URL IS the state. Derive chain/token/editor from searchParams.
  // Push URL values into context so child components can read them.
  // No bidirectional sync — one direction only: URL → context.
  // ---------------------------------------------------------------------------
  const urlChain = searchParams.get('chain') ?? null
  const urlEditor = searchParams.get('editor') ?? null

  // URL → context: keep context in sync with URL (context is a read cache)
  useEffect(() => {
    if (urlChain !== selectedChainId) selectChain(urlChain)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlChain])

  useEffect(() => {
    if (urlEditor === 'new' && !editorOpen) openNewEditor()
    else if (urlEditor && urlEditor !== 'new' && !editorOpen) openEditor(urlEditor)
    else if (!urlEditor && editorOpen) closeEditor()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlEditor])

  // URL-updating handlers passed to children — these are the primary actions
  const urlSelectChain = useCallback((chainId: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (chainId) next.set('chain', chainId)
      else { next.delete('chain'); next.delete('token') }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const urlSelectToken = useCallback((token: Token) => {
    selectToken(token) // update context immediately for configurator
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('chain', String(token.chainId))
      next.set('token', token.address)
      return next
    }, { replace: true })
  }, [setSearchParams, selectToken])

  return (
    <div className="h-screen">
      {/* Desktop: sliding three-panel */}
      <div className="hidden lg:block h-full overflow-hidden">
        <div
          className="flex h-full transition-transform duration-300 ease-in-out"
          style={{
            width: 'calc(200vw - 380px)',
            transform: editorOpen
              ? 'translateX(0)'
              : 'translateX(calc(-100vw + 380px))',
          }}
        >
          {/* Left: List Editor */}
          <div className="h-full" style={{ width: 'calc(100vw - 380px)' }}>
            <ListEditor />
          </div>

          {/* Center: Browser (always 380px) */}
          <div className="h-full w-[380px] flex-shrink-0 border-x border-border-light dark:border-border-dark bg-white dark:bg-surface-base">
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border-light dark:border-border-dark">
                <Link to="/" className="font-heading text-xl font-bold text-gradient-brand hover:opacity-80 transition-opacity">
                  Gib.Show
                </Link>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={openNewEditor}
                    className="relative group w-9 h-9 rounded-lg flex items-center justify-center transition-colors bg-gray-100 dark:bg-surface-2 text-gray-400 dark:text-gray-500 hover:text-accent-500 hover:bg-accent-500/10"
                    title="New List"
                  >
                    <i className="fas fa-plus text-sm" />
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 dark:bg-gray-700 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                      New List
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTestnets(!showTestnets)}
                    className={`relative group w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                      showTestnets
                        ? 'bg-accent-500/10 text-accent-500'
                        : 'bg-gray-100 dark:bg-surface-2 text-gray-400 dark:text-gray-500'
                    }`}
                    title={showTestnets ? 'Testnets visible' : 'Testnets hidden'}
                  >
                    <i className="fas fa-flask text-sm" />
                    <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 dark:bg-gray-700 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                      {showTestnets ? 'Hide testnets' : 'Show testnets'}
                    </span>
                  </button>
                  <ThemeToggle />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <StudioBrowser onInspectToken={setInspectToken} selectChain={urlSelectChain} selectToken={urlSelectToken} />
              </div>
            </div>
          </div>

          {/* Right: Studio Canvas / Configurator */}
          <div className="h-full" style={{ width: 'calc(100vw - 380px)' }}>
            <div className="h-full bg-surface-light-1 dark:bg-surface-1 overflow-y-auto">
              <StudioConfigurator />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: browser + bottom drawer */}
      <div className="lg:hidden h-full flex flex-col">
        {/* Mobile header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-base">
          <Link to="/" className="font-heading text-xl font-bold text-gradient-brand hover:opacity-80 transition-opacity">
            Gib.Show
          </Link>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={openNewEditor}
              className="relative group w-9 h-9 rounded-lg flex items-center justify-center transition-colors bg-gray-100 dark:bg-surface-2 text-gray-400 dark:text-gray-500 hover:text-accent-500 hover:bg-accent-500/10"
              title="New List"
            >
              <i className="fas fa-plus text-sm" />
            </button>
            <ThemeToggle />
          </div>
        </div>

        {/* Main content: browser or editor */}
        <div
          className="flex-1 overflow-y-auto bg-white dark:bg-surface-base"
          style={{ paddingBottom: selectedToken ? 48 : 0 }}
        >
          {editorOpen ? (
            <ListEditor />
          ) : (
            <StudioBrowser onInspectToken={setInspectToken} selectChain={urlSelectChain} selectToken={urlSelectToken} />
          )}
        </div>

        {/* Bottom drawer: configurator */}
        <BottomDrawer
          enabled={!!selectedToken}
          handle={
            selectedToken ? (
              <div className="flex items-center gap-2">
                {selectedToken.hasIcon && (
                  <Image
                    src={getApiUrl(`/image/${selectedToken.chainId}/${selectedToken.address}`)}
                    alt={selectedToken.symbol}
                    size={20}
                    skeleton
                    shape="circle"
                  />
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {selectedToken.name}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {selectedToken.symbol}
                </span>
              </div>
            ) : undefined
          }
        >
          <StudioConfigurator />
        </BottomDrawer>
      </div>

      {/* Token Detail Modal */}
      <TokenDetailModal
        token={inspectToken}
        onClose={() => setInspectToken(null)}
      />
    </div>
  )
}
