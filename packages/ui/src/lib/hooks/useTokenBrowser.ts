import { useState, useCallback } from 'react'
import type { Token } from '../types'

export function useTokenBrowser() {
  const [enabledLists, setEnabledLists] = useState<Set<string>>(new Set())
  const [tokensByList, setTokensByList] = useState<Map<string, Token[]>>(new Map())

  const toggleList = useCallback((listId: string, enabled: boolean) => {
    setEnabledLists((prev) => {
      const next = new Set(prev)
      if (enabled) next.add(listId)
      else next.delete(listId)
      return next
    })
  }, [])

  const toggleAll = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        setEnabledLists(new Set(tokensByList.keys()))
      } else {
        setEnabledLists(new Set())
      }
    },
    [tokensByList],
  )

  const setListTokens = useCallback((listId: string, tokens: Token[]) => {
    setTokensByList((prev) => {
      const next = new Map(prev)
      next.set(listId, tokens)
      return next
    })
    setEnabledLists((prev) => {
      const next = new Set(prev)
      next.add(listId)
      return next
    })
  }, [])

  const clearTokens = useCallback(() => {
    setTokensByList(new Map())
    setEnabledLists(new Set())
  }, [])

  return { enabledLists, tokensByList, toggleList, toggleAll, setListTokens, clearTokens }
}
