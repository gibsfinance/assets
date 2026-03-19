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
    <Popover className="relative flex border-l pl-2 border-surface-500">
      <PopoverButton className="list-filter-dropdown w-full sm:w-auto relative flex flex-row items-center">
        <i className="fas fa-filter mr-2"></i>({count})
      </PopoverButton>

      <PopoverPanel
        anchor="bottom end"
        className="list-filter-dropdown card bg-surface-100-900 absolute right-0 z-50 mt-1 w-64"
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-2 pt-2">
            <h3 className="h4">Token Lists</h3>
            <button
              className="variant-soft btn btn-sm"
              type="button"
              onClick={handleToggleAll}
            >
              <i className="fas fa-check-double mr-2"></i>
              Toggle All
            </button>
          </div>

          <label className="input-group input-group-divider grid-cols-[auto_1fr_auto] rounded-container-token px-2">
            <div className="ig-cell">
              <i className="fas fa-search"></i>
            </div>
            <input
              type="search"
              placeholder="Search lists..."
              className="input"
              value={listSearchQuery}
              onChange={(e) => setListSearchQuery(e.target.value)}
            />
          </label>

          <div className="overflow-y-auto" style={{ maxHeight: '300px' }}>
            {filteredLists.map(([listKey, tokens]) => (
              <label
                key={listKey}
                className="hover:bg-surface-hover flex cursor-pointer items-center gap-2 px-2"
              >
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={enabledLists.has(listKey)}
                  onChange={(e) => onToggleList(listKey, e.target.checked)}
                />
                <div className="flex-1">
                  <div className="font-medium">{listKey}</div>
                  <div className="text-xs opacity-75">
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
