import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useLocalLists, type LocalList } from '../hooks/useLocalLists'

interface ListEditorState {
  isOpen: boolean
  editingListId: string | null
  editingSourceKey: string | null
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

const ListEditorCtx = createContext<ListEditorContextValue | null>(null)

export function ListEditorProvider({ children }: { children: ReactNode }) {
  const localLists = useLocalLists()
  const [state, setState] = useState<ListEditorState>({
    isOpen: false,
    editingListId: null,
    editingSourceKey: null,
    activeList: null,
  })

  // Restore activeList from IndexedDB when editingListId is set (e.g. from URL)
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || localLists.isLoading || !state.editingListId) return
    const list = localLists.lists.find((l) => l.id === state.editingListId)
    if (list) {
      setState((s) => ({ ...s, activeList: list }))
      restoredRef.current = true
    }
  }, [localLists.isLoading, localLists.lists, state.editingListId])

  const openEditor = useCallback((sourceOrId: string) => {
    restoredRef.current = false

    // If it contains a slash, treat as remote source key (provider/key)
    if (sourceOrId.includes('/')) {
      const localFork = localLists.lists.find(
        (l) => l.source.remoteProvider === sourceOrId.split('/')[0] &&
               l.source.remoteKey === sourceOrId.split('/')[1]
      )
      setState({
        isOpen: true,
        editingListId: localFork?.id ?? null,
        editingSourceKey: sourceOrId,
        activeList: localFork ?? null,
      })
      return
    }

    // Otherwise treat as a local list ID
    const localList = localLists.lists.find((l) => l.id === sourceOrId)
    setState({
      isOpen: true,
      editingListId: sourceOrId,
      editingSourceKey: null,
      activeList: localList ?? null,
    })
  }, [localLists.lists])

  const openNewEditor = useCallback(() => {
    restoredRef.current = false
    setState({
      isOpen: true,
      editingListId: null,
      editingSourceKey: null,
      activeList: null,
    })
  }, [])

  const closeEditor = useCallback(() => {
    restoredRef.current = false
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
