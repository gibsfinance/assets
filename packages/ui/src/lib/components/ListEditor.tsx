import { useState, useCallback } from 'react'
import { useListEditor } from '../contexts/ListEditorContext'
import { getApiUrl } from '../utils'
import Image from './Image'
import type { LocalToken } from '../hooks/useLocalLists'

export default function ListEditor() {
  const {
    activeList,
    editingSourceKey,
    closeEditor,
    createList,
    setActiveList,
    updateList,
  } = useListEditor()

  const [importUrl, setImportUrl] = useState('')
  const [pasteJson, setPasteJson] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreateNew = useCallback(async () => {
    const list = await createList({
      name: 'Untitled List',
      source: { type: 'scratch' },
    })
    setActiveList(list)
  }, [createList, setActiveList])

  const handleFork = useCallback(async () => {
    if (!editingSourceKey) return
    setIsImporting(true)
    setError(null)
    try {
      const [provider, key] = editingSourceKey.split('/')
      const res = await fetch(getApiUrl(`/list/${provider}/${key}`))
      if (!res.ok) throw new Error(`Failed to fetch list: ${res.status}`)
      const data = await res.json()
      const tokens: LocalToken[] = (data.tokens || []).map((t: Record<string, unknown>, i: number) => ({
        chainId: Number(t.chainId),
        address: String(t.address),
        name: String(t.name || ''),
        symbol: String(t.symbol || ''),
        decimals: Number(t.decimals || 18),
        imageUri: t.logoURI ? String(t.logoURI) : undefined,
        order: i,
      }))
      const list = await createList({
        name: data.name || editingSourceKey,
        description: data.description || '',
        source: {
          type: 'fork',
          remoteProvider: provider,
          remoteKey: key,
        },
        tokens,
      })
      setActiveList(list)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsImporting(false)
    }
  }, [editingSourceKey, createList, setActiveList])

  const handleImportUrl = useCallback(async () => {
    if (!importUrl.trim()) return
    setIsImporting(true)
    setError(null)
    try {
      const res = await fetch(importUrl.trim())
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`)
      const data = await res.json()
      if (!data.tokens || !Array.isArray(data.tokens)) throw new Error('Invalid token list format')
      const tokens: LocalToken[] = data.tokens.map((t: Record<string, unknown>, i: number) => ({
        chainId: Number(t.chainId),
        address: String(t.address),
        name: String(t.name || ''),
        symbol: String(t.symbol || ''),
        decimals: Number(t.decimals || 18),
        imageUri: t.logoURI ? String(t.logoURI) : undefined,
        order: i,
      }))
      const list = await createList({
        name: data.name || 'Imported List',
        description: data.description || '',
        source: { type: 'import', remoteUrl: importUrl.trim() },
        tokens,
      })
      setActiveList(list)
      setImportUrl('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsImporting(false)
    }
  }, [importUrl, createList, setActiveList])

  const handlePasteJson = useCallback(async () => {
    if (!pasteJson.trim()) return
    setError(null)
    try {
      const data = JSON.parse(pasteJson.trim())
      const tokens: LocalToken[] = (data.tokens || [data]).flat().map((t: Record<string, unknown>, i: number) => ({
        chainId: Number(t.chainId || 1),
        address: String(t.address),
        name: String(t.name || ''),
        symbol: String(t.symbol || ''),
        decimals: Number(t.decimals || 18),
        imageUri: t.logoURI ? String(t.logoURI) : undefined,
        order: i,
      }))
      const list = await createList({
        name: data.name || 'Pasted List',
        source: { type: 'paste' },
        tokens,
      })
      setActiveList(list)
      setPasteJson('')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [pasteJson, createList, setActiveList])

  const handleNameChange = useCallback(async (name: string) => {
    if (!activeList) return
    const updated = await updateList(activeList.id, { name })
    if (updated) setActiveList(updated)
  }, [activeList, updateList, setActiveList])

  // ─── Creation Menu (no active list) ───────────────────────────
  if (!activeList) {
    return (
      <div className="flex h-full flex-col bg-white dark:bg-surface-base">
        <div className="flex items-center justify-between border-b border-border-light px-4 py-3 dark:border-border-dark">
          <h2 className="font-heading text-lg font-bold text-gray-900 dark:text-white">
            List Editor
          </h2>
          <button
            type="button"
            onClick={closeEditor}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-white/40 dark:hover:bg-surface-2 dark:hover:text-white/80"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-md space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            {/* New List */}
            <button
              type="button"
              onClick={handleCreateNew}
              className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-4 text-left transition-all hover:border-accent-500/40 hover:bg-accent-500/5 dark:border-surface-3 dark:hover:border-accent-500/40"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-500/10 text-accent-500">
                <i className="fas fa-plus" />
              </div>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">New List</div>
                <div className="text-xs text-gray-400 dark:text-white/40">Start from scratch</div>
              </div>
            </button>

            {/* Fork (only if editing a remote list) */}
            {editingSourceKey && (
              <button
                type="button"
                onClick={handleFork}
                disabled={isImporting}
                className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-4 text-left transition-all hover:border-accent-500/40 hover:bg-accent-500/5 disabled:opacity-50 dark:border-surface-3 dark:hover:border-accent-500/40"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-500">
                  <i className="fas fa-code-branch" />
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    Fork {editingSourceKey}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-white/40">
                    Copy this list and edit locally
                  </div>
                </div>
              </button>
            )}

            {/* Import URL */}
            <div className="rounded-lg border border-gray-200 p-4 dark:border-surface-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                <i className="fas fa-link text-xs text-gray-400" />
                Import from URL
              </div>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://tokens.uniswap.org"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-surface-3 dark:bg-surface-2 dark:text-white dark:placeholder:text-white/30"
                />
                <button
                  type="button"
                  onClick={handleImportUrl}
                  disabled={!importUrl.trim() || isImporting}
                  className="btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                >
                  {isImporting ? '...' : 'Import'}
                </button>
              </div>
            </div>

            {/* Paste JSON */}
            <div className="rounded-lg border border-gray-200 p-4 dark:border-surface-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                <i className="fas fa-paste text-xs text-gray-400" />
                Paste JSON
              </div>
              <textarea
                placeholder='{"tokens": [...]}'
                value={pasteJson}
                onChange={(e) => setPasteJson(e.target.value)}
                rows={4}
                className="mb-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-900 placeholder:text-gray-400 dark:border-surface-3 dark:bg-surface-2 dark:text-white dark:placeholder:text-white/30"
              />
              <button
                type="button"
                onClick={handlePasteJson}
                disabled={!pasteJson.trim()}
                className="btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                Parse & Import
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── Active List View ─────────────────────────────────────────
  return (
    <div className="flex h-full flex-col bg-white dark:bg-surface-base">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-light px-4 py-3 dark:border-border-dark">
        <div className="flex items-center gap-3 min-w-0">
          <input
            type="text"
            value={activeList.name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="min-w-0 border-none bg-transparent font-heading text-lg font-bold text-gray-900 outline-none focus:ring-0 dark:text-white"
          />
          <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-surface-2 dark:text-white/40">
            {activeList.source.type}
          </span>
        </div>
        <button
          type="button"
          onClick={closeEditor}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-white/40 dark:hover:bg-surface-2 dark:hover:text-white/80"
        >
          <i className="fas fa-times" />
        </button>
      </div>

      {/* Token count bar */}
      <div className="flex items-center justify-between border-b border-border-light px-4 py-2 dark:border-border-dark">
        <span className="text-xs text-gray-500 dark:text-white/40">
          {activeList.tokens.length} token{activeList.tokens.length !== 1 ? 's' : ''}
        </span>
        {activeList.source.remoteProvider && (
          <span className="text-[10px] text-gray-400 dark:text-white/30">
            forked from {activeList.source.remoteProvider}/{activeList.source.remoteKey}
          </span>
        )}
      </div>

      {/* Token list (simple view — drag-and-drop in Phase 3) */}
      <div className="flex-1 overflow-y-auto">
        {activeList.tokens.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-white/30">
            No tokens yet. Add some to get started.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-surface-3">
            {activeList.tokens.map((token) => (
              <div key={`${token.chainId}-${token.address}`} className="flex items-center gap-3 px-4 py-2">
                <Image
                  src={token.imageUri || getApiUrl(`/image/${token.chainId}/${token.address}`)}
                  size={24}
                  skeleton
                  lazy
                  shape="circle"
                  className="rounded-full"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between">
                    <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">{token.name}</span>
                    <span className="flex-shrink-0 font-mono text-[10px] text-gray-400 dark:text-white/30">
                      {token.address.slice(0, 6)}...{token.address.slice(-4)}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 dark:text-white/40">{token.symbol}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
