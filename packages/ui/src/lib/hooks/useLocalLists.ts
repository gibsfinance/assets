import { useState, useEffect, useCallback } from 'react'
import { get, set, del, keys } from 'idb-keyval'

const IDB_PREFIX = 'gib-list:'

export interface LocalListSource {
  type: 'scratch' | 'fork' | 'import' | 'paste'
  remoteProvider?: string
  remoteKey?: string
  remoteUrl?: string
}

export interface LocalToken {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
  imageUri?: string
  order: number
}

export interface LocalList {
  id: string
  name: string
  description: string
  tokens: LocalToken[]
  source: LocalListSource
  createdAt: string
  updatedAt: string
}

function generateId(): string {
  return crypto.randomUUID()
}

function idbKey(id: string): string {
  return `${IDB_PREFIX}${id}`
}

export function useLocalLists() {
  const [lists, setLists] = useState<LocalList[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setIsLoading(true)
    try {
      const allKeys = await keys()
      const listKeys = (allKeys as string[]).filter((k) => k.startsWith(IDB_PREFIX))
      const loaded = await Promise.all(
        listKeys.map(async (k) => {
          const val = await get<LocalList>(k)
          return val ?? null
        }),
      )
      setLists(loaded.filter(Boolean) as LocalList[])
    } catch (err) {
      console.error('Failed to load local lists:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const createList = useCallback(
    async (params: {
      name: string
      description?: string
      source: LocalListSource
      tokens?: LocalToken[]
    }): Promise<LocalList> => {
      const now = new Date().toISOString()
      const list: LocalList = {
        id: generateId(),
        name: params.name,
        description: params.description || '',
        tokens: params.tokens || [],
        source: params.source,
        createdAt: now,
        updatedAt: now,
      }
      await set(idbKey(list.id), list)
      setLists((prev) => [...prev, list])
      return list
    },
    [],
  )

  const updateList = useCallback(async (id: string, updates: Partial<Omit<LocalList, 'id' | 'createdAt'>>) => {
    const existing = await get<LocalList>(idbKey(id))
    if (!existing) return null
    const updated: LocalList = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    await set(idbKey(id), updated)
    setLists((prev) => prev.map((l) => (l.id === id ? updated : l)))
    return updated
  }, [])

  const deleteList = useCallback(async (id: string) => {
    await del(idbKey(id))
    setLists((prev) => prev.filter((l) => l.id !== id))
  }, [])

  const getList = useCallback(async (id: string): Promise<LocalList | null> => {
    const val = await get<LocalList>(idbKey(id))
    return val ?? null
  }, [])

  const addToken = useCallback(
    async (listId: string, token: Omit<LocalToken, 'order'>): Promise<LocalList | null> => {
      const existing = await get<LocalList>(idbKey(listId))
      if (!existing) return null
      const maxOrder = existing.tokens.reduce((max, t) => Math.max(max, t.order), -1)
      const updated: LocalList = {
        ...existing,
        tokens: [...existing.tokens, { ...token, order: maxOrder + 1 }],
        updatedAt: new Date().toISOString(),
      }
      await set(idbKey(listId), updated)
      setLists((prev) => prev.map((l) => (l.id === listId ? updated : l)))
      return updated
    },
    [],
  )

  const removeToken = useCallback(async (listId: string, address: string): Promise<LocalList | null> => {
    const existing = await get<LocalList>(idbKey(listId))
    if (!existing) return null
    const updated: LocalList = {
      ...existing,
      tokens: existing.tokens.filter((t) => t.address.toLowerCase() !== address.toLowerCase()),
      updatedAt: new Date().toISOString(),
    }
    await set(idbKey(listId), updated)
    setLists((prev) => prev.map((l) => (l.id === listId ? updated : l)))
    return updated
  }, [])

  const reorderTokens = useCallback(async (listId: string, tokens: LocalToken[]): Promise<LocalList | null> => {
    const existing = await get<LocalList>(idbKey(listId))
    if (!existing) return null
    const updated: LocalList = {
      ...existing,
      tokens: tokens.map((t, i) => ({ ...t, order: i })),
      updatedAt: new Date().toISOString(),
    }
    await set(idbKey(listId), updated)
    setLists((prev) => prev.map((l) => (l.id === listId ? updated : l)))
    return updated
  }, [])

  return {
    lists,
    isLoading,
    createList,
    updateList,
    deleteList,
    getList,
    addToken,
    removeToken,
    reorderTokens,
    reload: loadAll,
  }
}
