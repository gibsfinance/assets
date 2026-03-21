import { useState, useMemo } from 'react'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import type { Token } from '../types'

interface TokenListFilterProps {
  selectedChain: number | null
  enabledLists: Set<string>
  tokensByList: Map<string, Token[]>
  onToggleList: (listId: string, enabled: boolean) => void
  onToggleAll: (enabled: boolean) => void
}

export default function TokenListFilter({
  selectedChain,
  enabledLists,
  tokensByList,
  onToggleList,
  onToggleAll,
}: TokenListFilterProps) {
  const [listSearchQuery, setListSearchQuery] = useState('')

  const list = useMemo(() => Array.from(tokensByList.entries()), [tokensByList])

  const underChain = useMemo(
    () =>
      list.filter(([, tokens]) => {
        const tokensForNetwork = tokens.filter(
          (token) => token.chainId === selectedChain,
        )
        return tokensForNetwork.length > 0
      }),
    [list, selectedChain],
  )

  const count = underChain.length

  const filteredLists = useMemo(
    () =>
      underChain.filter(
        ([key]) =>
          !listSearchQuery ||
          key.toLowerCase().includes(listSearchQuery.toLowerCase()),
      ),
    [underChain, listSearchQuery],
  )

  function handleToggleAll() {
    const allEnabled = filteredLists.every(([key]) => enabledLists.has(key))
    onToggleAll(!allEnabled)
  }

  return (
    <Popover className="relative flex border-l border-gray-200 pl-2 dark:border-surface-3">
      <PopoverButton className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-white/40 dark:hover:bg-surface-3 dark:hover:text-white/70">
        <i className="fas fa-filter text-[10px]" />
        <span>{count}</span>
      </PopoverButton>

      <PopoverPanel
        anchor="bottom end"
        className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-surface-3 dark:bg-surface-1"
      >
        <div className="flex flex-col gap-2 p-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-900 dark:text-white">Token Lists</h3>
            <button
              className="rounded px-2 py-0.5 text-[10px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-white/40 dark:hover:bg-surface-2 dark:hover:text-white/70"
              type="button"
              onClick={handleToggleAll}
            >
              Toggle All
            </button>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 dark:border-surface-3 dark:bg-surface-2">
            <i className="fas fa-search text-[10px] text-gray-400 dark:text-white/30" />
            <input
              type="search"
              placeholder="Search lists..."
              className="w-full bg-transparent text-xs text-gray-900 outline-none placeholder:text-gray-400 dark:text-white/80 dark:placeholder:text-white/30"
              value={listSearchQuery}
              onChange={(e) => setListSearchQuery(e.target.value)}
            />
          </div>

          {/* List items */}
          <div className="max-h-[300px] overflow-y-auto">
            {filteredLists.map(([listKey, tokens]) => {
              const isEnabled = enabledLists.has(listKey)
              return (
                <label
                  key={listKey}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-surface-2"
                >
                  <div
                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                      isEnabled
                        ? 'border-accent-500 bg-accent-500 text-white'
                        : 'border-gray-300 bg-white dark:border-surface-3 dark:bg-surface-2'
                    }`}
                    onClick={(e) => {
                      e.preventDefault()
                      onToggleList(listKey, !isEnabled)
                    }}
                  >
                    {isEnabled && <i className="fas fa-check text-[8px]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-gray-800 dark:text-white/80">
                      {listKey}
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-white/30">
                      {tokens.filter((token) => token.chainId === selectedChain).length} tokens
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      </PopoverPanel>
    </Popover>
  )
}
