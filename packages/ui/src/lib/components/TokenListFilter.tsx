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
    <Popover className="relative flex border-l border-border-dark pl-2">
      <PopoverButton className="flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-accent-500">
        <i className="fas fa-filter" />
        <span>({count})</span>
      </PopoverButton>

      <PopoverPanel
        anchor="bottom end"
        className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-xl border border-border-dark bg-surface-1 shadow-elevated"
      >
        <div className="flex flex-col gap-2 p-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-sm font-semibold text-white">Token Lists</h3>
            <button
              className="btn-ghost px-3 py-1 text-xs"
              type="button"
              onClick={handleToggleAll}
            >
              <i className="fas fa-check-double mr-1" />
              Toggle All
            </button>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 rounded-lg border border-border-dark bg-surface-2 px-3 py-1.5">
            <i className="fas fa-search text-xs text-white/30" />
            <input
              type="search"
              placeholder="Search lists..."
              className="w-full bg-transparent text-sm text-white/80 outline-none placeholder:text-white/30"
              value={listSearchQuery}
              onChange={(e) => setListSearchQuery(e.target.value)}
            />
          </div>

          {/* List items */}
          <div className="max-h-[300px] overflow-y-auto">
            {filteredLists.map(([listKey, tokens]) => (
              <label
                key={listKey}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent-500/5"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border-dark bg-surface-2 text-accent-500 focus:ring-accent-500/30"
                  checked={enabledLists.has(listKey)}
                  onChange={(e) => onToggleList(listKey, e.target.checked)}
                />
                <div className="flex-1 overflow-hidden">
                  <div className="truncate text-sm font-medium text-white/80">
                    {listKey}
                  </div>
                  <div className="text-xs text-white/40">
                    {tokens.filter((token) => token.chainId === selectedChain).length}{' '}
                    tokens
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </PopoverPanel>
    </Popover>
  )
}
