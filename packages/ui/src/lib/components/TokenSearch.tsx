import { useState, useCallback } from 'react'
import { useTokenSearch } from '../hooks/useTokenSearch'
import type { SearchUpdate, Token } from '../types'
import TokenListFilter from './TokenListFilter'
import { faMagnifyingGlass, faSpinner } from '@fortawesome/free-solid-svg-icons'
import { Icon } from './Icon'

interface TokenSearchProps {
  onSearchUpdate: (state: SearchUpdate) => void
  count: number
  selectedChain: number | null
  enabledLists: Set<string>
  tokensByList: Map<string, Token[]>
  onToggleList: (listId: string, enabled: boolean) => void
  onToggleAll: (enabled: boolean) => void
}

export default function TokenSearch({
  onSearchUpdate,
  count,
  selectedChain,
  enabledLists,
  tokensByList,
  onToggleList,
  onToggleAll,
}: TokenSearchProps) {
  const [query, setQuery] = useState('')
  const { isSearching, search } = useTokenSearch({ onUpdate: onSearchUpdate })

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      // Nothing gates this on the search in flight. It used to return early while one was
      // running and nothing lowered that flag when the search finished, so the very first
      // search froze the controlled input for good — the user could neither refine the
      // query nor clear it. A keystroke supersedes the running search instead.
      const value = event.target.value
      setQuery(value)
      search(value)
    },
    [search],
  )

  return (
    <div className="flex flex-col sm:flex-row">
      <div className="flex flex-1 items-center gap-2 border-b border-border-strong bg-surface-inset px-4 py-2 focus-within:ring-2 focus-within:ring-inset focus-within:ring-accent/50">
        <Icon icon={faMagnifyingGlass} className="text-xs text-content-faint" />
        <input
          type="search"
          placeholder={`Search ${count} tokens...`}
          className="flex-1 bg-transparent text-sm text-content-strong outline-none placeholder:text-content-faint"
          value={query}
          onChange={handleChange}
        />
        {isSearching && <Icon icon={faSpinner} spin className="text-xs text-accent-content" />}
        <TokenListFilter
          selectedChain={selectedChain}
          enabledLists={enabledLists}
          tokensByList={tokensByList}
          onToggleList={onToggleList}
          onToggleAll={onToggleAll}
        />
      </div>
    </div>
  )
}
