import { useState } from 'react'
import { Link } from 'react-router-dom'
import StudioBrowser from '../components/StudioBrowser'
import StudioConfigurator from '../components/StudioConfigurator'
import TokenDetailModal from '../components/TokenDetailModal'
import { ThemeToggle } from '../components/ThemeToggle'
import { useStudio } from '../contexts/StudioContext'
import { useSettings } from '../contexts/SettingsContext'
import type { Token } from '../types'

export default function Studio() {
  const { activeTab, setActiveTab } = useStudio()
  const { showTestnets, setShowTestnets } = useSettings()
  const [inspectToken, setInspectToken] = useState<Token | null>(null)

  return (
    <div className="h-screen">
      {/* Desktop: split panel */}
      <div className="hidden lg:grid lg:grid-cols-[380px_1fr] h-full">
        <div className="h-full flex flex-col border-r border-border-light dark:border-border-dark bg-white dark:bg-surface-base">
          {/* Sidebar header: logo + toggle */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-light dark:border-border-dark">
            <Link to="/" className="font-heading text-xl font-bold text-gradient-brand hover:opacity-80 transition-opacity">
              Gib.Show
            </Link>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTestnets(!showTestnets)}
                className={`relative group w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
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
          {/* Token browser */}
          <div className="flex-1 overflow-y-auto">
            <StudioBrowser onInspectToken={setInspectToken} />
          </div>
        </div>
        <div className="h-full bg-surface-light-1 dark:bg-surface-1 overflow-y-auto">
          <StudioConfigurator />
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
          {activeTab === 'browse' ? (
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
