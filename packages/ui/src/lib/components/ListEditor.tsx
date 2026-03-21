import { useState, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useListEditor } from '../contexts/ListEditorContext'
import { getApiUrl } from '../utils'
import Image from './Image'
import ListTokenRow from './ListTokenRow'
import TokenImageManager from './TokenImageManager'
import { useRpcMetadata } from '../hooks/useRpcMetadata'
import { useVCSPublish, createGitHubPublisher } from '../hooks/useVCSPublish'
import type { LocalToken } from '../hooks/useLocalLists'

export default function ListEditor() {
  const {
    activeList,
    editingSourceKey,
    closeEditor,
    createList,
    setActiveList,
    updateList,
    addToken,
    removeToken,
    reorderTokens,
  } = useListEditor()

  const [importUrl, setImportUrl] = useState('')
  const [pasteJson, setPasteJson] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addAddress, setAddAddress] = useState('')
  const [editingImageToken, setEditingImageToken] = useState<LocalToken | null>(null)

  const { loadMetadata, isLoading: isLoadingMetadata, progress: metadataProgress } = useRpcMetadata()
  const { publish, isPublishing, publishResult, error: publishError } = useVCSPublish()
  const githubPublisher = createGitHubPublisher(getApiUrl(''))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || !activeList) return
      const oldIndex = activeList.tokens.findIndex((t) => `${t.chainId}-${t.address}` === active.id)
      const newIndex = activeList.tokens.findIndex((t) => `${t.chainId}-${t.address}` === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      const newTokens = [...activeList.tokens]
      const [moved] = newTokens.splice(oldIndex, 1)
      newTokens.splice(newIndex, 0, moved)
      const updated = await reorderTokens(activeList.id, newTokens)
      if (updated) setActiveList(updated)
    },
    [activeList, reorderTokens, setActiveList],
  )

  const handleAddToken = useCallback(async () => {
    if (!addAddress.trim() || !activeList) return
    const address = addAddress.trim().toLowerCase()
    if (activeList.tokens.some((t) => t.address.toLowerCase() === address)) {
      setError('Token already in list')
      return
    }
    const chainId = activeList.tokens[0]?.chainId || 1
    const updated = await addToken(activeList.id, {
      chainId,
      address,
      name: '',
      symbol: '',
      decimals: 18,
    })
    if (updated) {
      setActiveList(updated)
      setAddAddress('')
    }
  }, [addAddress, activeList, addToken, setActiveList])

  const handleRemoveToken = useCallback(
    async (address: string) => {
      if (!activeList) return
      const updated = await removeToken(activeList.id, address)
      if (updated) setActiveList(updated)
    },
    [activeList, removeToken, setActiveList],
  )

  const handleLoadMetadata = useCallback(async () => {
    if (!activeList || activeList.tokens.length === 0) return
    const chainId = activeList.tokens[0]?.chainId || 1
    const results = await loadMetadata(activeList.tokens, chainId)
    const updatedTokens = activeList.tokens.map((token) => {
      const meta = results.find((r) => r.address.toLowerCase() === token.address.toLowerCase())
      if (!meta) return token
      return {
        ...token,
        name: meta.name || token.name,
        symbol: meta.symbol || token.symbol,
        decimals: meta.decimals ?? token.decimals,
      }
    })
    const updated = await reorderTokens(activeList.id, updatedTokens)
    if (updated) setActiveList(updated)
  }, [activeList, loadMetadata, reorderTokens, setActiveList])

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
      const tokens: LocalToken[] = (data.tokens || []).map(
        (t: Record<string, unknown>, i: number) => ({
          chainId: Number(t.chainId),
          address: String(t.address),
          name: String(t.name || ''),
          symbol: String(t.symbol || ''),
          decimals: Number(t.decimals || 18),
          imageUri: t.logoURI ? String(t.logoURI) : undefined,
          order: i,
        }),
      )
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
      if (!data.tokens || !Array.isArray(data.tokens))
        throw new Error('Invalid token list format')
      const tokens: LocalToken[] = data.tokens.map(
        (t: Record<string, unknown>, i: number) => ({
          chainId: Number(t.chainId),
          address: String(t.address),
          name: String(t.name || ''),
          symbol: String(t.symbol || ''),
          decimals: Number(t.decimals || 18),
          imageUri: t.logoURI ? String(t.logoURI) : undefined,
          order: i,
        }),
      )
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
      const tokens: LocalToken[] = (data.tokens || [data])
        .flat()
        .map((t: Record<string, unknown>, i: number) => ({
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

  const handleNameChange = useCallback(
    async (name: string) => {
      if (!activeList) return
      const updated = await updateList(activeList.id, { name })
      if (updated) setActiveList(updated)
    },
    [activeList, updateList, setActiveList],
  )

  const handleImageChange = useCallback(
    async (uri: string) => {
      if (!activeList || !editingImageToken) return
      const updatedTokens = activeList.tokens.map((t) =>
        t.address.toLowerCase() === editingImageToken.address.toLowerCase() &&
        t.chainId === editingImageToken.chainId
          ? { ...t, imageUri: uri }
          : t,
      )
      const updated = await reorderTokens(activeList.id, updatedTokens)
      if (updated) setActiveList(updated)
    },
    [activeList, editingImageToken, reorderTokens, setActiveList],
  )

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
    <div className="relative flex h-full flex-col bg-white dark:bg-surface-base">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-light px-4 py-3 dark:border-border-dark">
        <div className="flex min-w-0 items-center gap-3">
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
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => activeList && publish(githubPublisher, activeList)}
            disabled={isPublishing || !activeList || activeList.tokens.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            title="Publish to GitHub"
          >
            <i className="fab fa-github text-sm" />
            {isPublishing ? 'Publishing...' : 'Publish'}
          </button>
          <button
            type="button"
            onClick={closeEditor}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-white/40 dark:hover:bg-surface-2 dark:hover:text-white/80"
          >
            <i className="fas fa-times" />
          </button>
        </div>
      </div>

      {/* Publish result banner */}
      {publishResult && (
        <div className="border-b border-border-light bg-green-50 px-4 py-2 dark:border-border-dark dark:bg-green-900/20">
          <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
            <i className="fas fa-check-circle" />
            <span>Published!</span>
            <a href={publishResult.repoUrl} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
              View repo
            </a>
            {publishResult.fileUrl && (
              <a href={publishResult.fileUrl} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
                View file
              </a>
            )}
          </div>
        </div>
      )}
      {publishError && (
        <div className="border-b border-border-light bg-red-50 px-4 py-2 dark:border-border-dark dark:bg-red-900/20">
          <span className="text-xs text-red-600 dark:text-red-400">{publishError}</span>
        </div>
      )}

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

      {/* Toolbar: add token + load RPC */}
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-2 dark:border-border-dark">
        <div className="flex flex-1 gap-2">
          <input
            type="text"
            placeholder="0x... token address"
            value={addAddress}
            onChange={(e) => setAddAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddToken()}
            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 font-mono text-xs text-gray-900 placeholder:text-gray-400 dark:border-surface-3 dark:bg-surface-2 dark:text-white dark:placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={handleAddToken}
            disabled={!addAddress.trim()}
            className="btn-primary rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <button
          type="button"
          onClick={handleLoadMetadata}
          disabled={isLoadingMetadata || activeList.tokens.length === 0}
          className="btn-secondary rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          title="Load name, symbol, decimals from chain RPC"
        >
          {isLoadingMetadata
            ? `${metadataProgress.done}/${metadataProgress.total}`
            : 'Load RPC'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-b border-border-light px-4 py-2 dark:border-border-dark">
          <div className="rounded-lg bg-red-50 p-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        </div>
      )}

      {/* Sortable token list */}
      <div className="flex-1 overflow-y-auto">
        {activeList.tokens.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-white/30">
            No tokens yet. Add an address above.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={activeList.tokens.map((t) => `${t.chainId}-${t.address}`)}
              strategy={verticalListSortingStrategy}
            >
              {activeList.tokens.map((token) => (
                <ListTokenRow
                  key={`${token.chainId}-${token.address}`}
                  token={token}
                  onRemove={handleRemoveToken}
                  onImageClick={setEditingImageToken}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Image manager overlay */}
      {editingImageToken && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/40">
          <TokenImageManager
            chainId={editingImageToken.chainId}
            address={editingImageToken.address}
            currentImageUri={editingImageToken.imageUri}
            onImageChange={handleImageChange}
            onClose={() => setEditingImageToken(null)}
          />
        </div>
      )}
    </div>
  )
}
