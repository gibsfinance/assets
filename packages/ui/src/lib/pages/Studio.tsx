import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ListEditor from '../components/ListEditor'
import StudioBrowser from '../components/StudioBrowser'
import StudioConfigurator from '../components/StudioConfigurator'
import TokenDetailModal from '../components/TokenDetailModal'
import { ThemeToggle } from '../components/ThemeToggle'
import { useListEditor } from '../contexts/ListEditorContext'
import { useStudio } from '../contexts/StudioContext'
import { useSettings } from '../contexts/SettingsContext'
import type { Token } from '../types'

export default function Studio() {
  const { activeTab, setActiveTab } = useStudio()
  const { showTestnets, setShowTestnets } = useSettings()
  const { isOpen: editorOpen, openNewEditor } = useListEditor()
  const [inspectToken, setInspectToken] = useState<Token | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (searchParams.get('editor') === 'new') {
      openNewEditor()
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, openNewEditor, setSearchParams])

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
                <StudioBrowser onInspectToken={setInspectToken} />
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

      {/* Mobile: tabbed */}
      <div className="lg:hidden h-full flex flex-col">
        {/* Mobile header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-base">
          <Link to="/" className="font-heading text-xl font-bold text-gradient-brand hover:opacity-80 transition-opacity">
            Gib.Show
          </Link>
          <ThemeToggle />
        </div>
        {/* Tab bar */}
        <div className="flex border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-base">
          {editorOpen && (
            <button
              onClick={() => setActiveTab('editor')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'editor'
                  ? 'text-accent-500 border-b-2 border-accent-500'
                  : 'text-gray-500'
              }`}
            >
              Editor
            </button>
          )}
          <button
            onClick={() => setActiveTab('browse')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'browse'
                ? 'text-accent-500 border-b-2 border-accent-500'
                : 'text-gray-500'
            }`}
          >
            Browse
          </button>
          <button
            onClick={() => setActiveTab('configure')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'configure'
                ? 'text-accent-500 border-b-2 border-accent-500'
                : 'text-gray-500'
            }`}
          >
            Configure
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-white dark:bg-surface-base">
          {activeTab === 'editor' && editorOpen ? (
            <ListEditor />
          ) : activeTab === 'browse' ? (
            <StudioBrowser onInspectToken={setInspectToken} />
          ) : (
            <StudioConfigurator />
          )}
        </div>
      </div>

      {/* Token Detail Modal */}
      <TokenDetailModal
        token={inspectToken}
        onClose={() => setInspectToken(null)}
      />
    </div>
  )
}
