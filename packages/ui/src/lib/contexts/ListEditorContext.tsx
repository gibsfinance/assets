import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useLocalLists, type LocalList } from '../hooks/useLocalLists'

interface ListEditorState {
  isOpen: boolean
  editingListId: string | null
  editingSourceKey: string | null // remote key like 'piteas/exchange'
  activeList: LocalList | null
}

interface ListEditorContextValue extends ListEditorState {
  openEditor: (sourceList: string) => void
  openNewEditor: () => void
  closeEditor: () => void
  setActiveList: (list: LocalList) => void
  lists: LocalList[]
  isLoadingLists: boolean
  createList: ReturnType<typeof useLocalLists>['createList']
  updateList: ReturnType<typeof useLocalLists>['updateList']
  deleteList: ReturnType<typeof useLocalLists>['deleteList']
  addToken: ReturnType<typeof useLocalLists>['addToken']
  removeToken: ReturnType<typeof useLocalLists>['removeToken']
  reorderTokens: ReturnType<typeof useLocalLists>['reorderTokens']
}

const EDITOR_STORAGE_KEY = 'gib-editor-state'

function loadEditorState(): { editingListId: string | null; editingSourceKey: string | null } {
  try {
    const raw = localStorage.getItem(EDITOR_STORAGE_KEY)
    if (!raw) return { editingListId: null, editingSourceKey: null }
    return JSON.parse(raw)
  } catch {
    return { editingListId: null, editingSourceKey: null }
  }
}

const ListEditorCtx = createContext<ListEditorContextValue | null>(null)

export function ListEditorProvider({ children }: { children: ReactNode }) {
  const localLists = useLocalLists()
  const [state, setState] = useState<ListEditorState>(() => {
    const persisted = loadEditorState()
    return {
      isOpen: !!(persisted.editingListId || persisted.editingSourceKey),
      editingListId: persisted.editingListId,
      editingSourceKey: persisted.editingSourceKey,
      activeList: null, // restored from localLists once loaded
    }
  })

  // Restore activeList from IndexedDB once lists are loaded
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || localLists.isLoading || !state.editingListId) return
    const list = localLists.lists.find((l) => l.id === state.editingListId)
    if (list) {
      setState((s) => ({ ...s, activeList: list }))
      restoredRef.current = true
    }
  }, [localLists.isLoading, localLists.lists, state.editingListId])

  // Persist editor state
  useEffect(() => {
    if (state.isOpen) {
      localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify({
        editingListId: state.editingListId,
        editingSourceKey: state.editingSourceKey,
      }))
    } else {
      localStorage.removeItem(EDITOR_STORAGE_KEY)
    }
  }, [state.isOpen, state.editingListId, state.editingSourceKey])

  const openEditor = useCallback((sourceList: string) => {
    // Check if we have a local fork of this remote list
    const localFork = localLists.lists.find(
      (l) => l.source.remoteProvider === sourceList.split('/')[0] &&
             l.source.remoteKey === sourceList.split('/')[1]
    )
    setState({
      isOpen: true,
      editingListId: localFork?.id ?? null,
      editingSourceKey: sourceList,
      activeList: localFork ?? null,
    })
  }, [localLists.lists])

  const openNewEditor = useCallback(() => {
    setState({
      isOpen: true,
      editingListId: null,
      editingSourceKey: null,
      activeList: null,
    })
  }, [])

  const closeEditor = useCallback(() => {
    setState({
      isOpen: false,
      editingListId: null,
      editingSourceKey: null,
      activeList: null,
    })
  }, [])

  const setActiveList = useCallback((list: LocalList) => {
    setState((s) => ({
      ...s,
      editingListId: list.id,
      activeList: list,
    }))
  }, [])

  return (
    <ListEditorCtx.Provider
      value={{
        ...state,
        openEditor,
        openNewEditor,
        closeEditor,
        setActiveList,
        lists: localLists.lists,
        isLoadingLists: localLists.isLoading,
        createList: localLists.createList,
        updateList: localLists.updateList,
        deleteList: localLists.deleteList,
        addToken: localLists.addToken,
        removeToken: localLists.removeToken,
        reorderTokens: localLists.reorderTokens,
      }}
    >
      {children}
    </ListEditorCtx.Provider>
  )
}

export function useListEditor() {
  const ctx = useContext(ListEditorCtx)
  if (!ctx) throw new Error('useListEditor must be used within ListEditorProvider')
  return ctx
}
