import { useState, useMemo } from 'react'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import type { Token } from '../types'
import { faCheck, faFilter, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { Icon } from './Icon'

export interface TokenListFilterProps {
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
        const tokensForNetwork = tokens.filter((token) => token.chainId === selectedChain)
        return tokensForNetwork.length > 0
      }),
    [list, selectedChain],
  )

  const count = underChain.length

  const filteredLists = useMemo(
    () => underChain.filter(([key]) => !listSearchQuery || key.toLowerCase().includes(listSearchQuery.toLowerCase())),
    [underChain, listSearchQuery],
  )

  function handleToggleAll() {
    const allEnabled = filteredLists.every(([key]) => enabledLists.has(key))
    onToggleAll(!allEnabled)
  }

  return (
    <Popover className="relative flex border-l border-border-strong pl-2">
      <PopoverButton className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-content-faint transition-colors hover:bg-surface-control hover:text-content-muted">
        <Icon icon={faFilter} className="text-[10px]" />
        <span>{count}</span>
      </PopoverButton>

      <PopoverPanel
        anchor="bottom"
        className="absolute z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border-strong bg-surface-raised shadow-lg">
        <div className="flex flex-col gap-2 p-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-content-strong">Token Lists</h3>
            <button
              className="rounded px-2 py-0.5 text-[10px] text-content-faint transition-colors hover:bg-surface-inset hover:text-content-muted"
              type="button"
              onClick={handleToggleAll}>
              Toggle All
            </button>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-inset px-2.5 py-1.5 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/50">
            <Icon icon={faMagnifyingGlass} className="text-[10px] text-content-faint" />
            <input
              type="search"
              placeholder="Search lists..."
              className="w-full bg-transparent text-xs text-content-strong outline-none placeholder:text-content-faint"
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
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-inset">
                  <div
                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                      isEnabled ? 'border-accent bg-accent text-black' : 'border-border-strong bg-surface-overlay'
                    }`}
                    onClick={(e) => {
                      e.preventDefault()
                      onToggleList(listKey, !isEnabled)
                    }}>
                    {isEnabled && <Icon icon={faCheck} className="text-[8px]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-content-body">{listKey}</div>
                    <div className="text-[10px] text-content-faint">
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
