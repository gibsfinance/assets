import { useState } from 'react'
import StudioBrowser from '../components/StudioBrowser'
import StudioConfigurator from '../components/StudioConfigurator'
import TokenDetailModal from '../components/TokenDetailModal'
import { useStudio } from '../contexts/StudioContext'
import type { Token } from '../types'

export default function Studio() {
  const { activeTab, setActiveTab } = useStudio()
  const [inspectToken, setInspectToken] = useState<Token | null>(null)

  return (
    <div className="h-[calc(100vh-57px)]">
      {/* Desktop: split panel */}
      <div className="hidden lg:grid lg:grid-cols-[380px_1fr] h-full">
        <div className="h-full border-r border-border-light dark:border-border-dark bg-white dark:bg-surface-base overflow-y-auto">
          <StudioBrowser onInspectToken={setInspectToken} />
        </div>
        <div className="h-full bg-surface-light-1 dark:bg-surface-1 overflow-y-auto">
          <StudioConfigurator />
        </div>
      </div>

      {/* Mobile: tabbed */}
      <div className="lg:hidden h-full flex flex-col">
        <div className="flex border-b border-border-light dark:border-border-dark">
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
