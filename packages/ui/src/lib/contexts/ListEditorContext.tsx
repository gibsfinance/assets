import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import { useLocalLists, type LocalList } from '../hooks/useLocalLists'

interface ListEditorState {
  isOpen: boolean
  editingListId: string | null
  editingSourceKey: string | null
}

interface ListEditorContextValue extends ListEditorState {
  activeList: LocalList | null
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
  })

  // Derived: activeList is computed from editingListId + loaded lists
  const activeList = useMemo(() => {
    if (!state.editingListId) return null
    return localLists.lists.find((l) => l.id === state.editingListId) ?? null
  }, [state.editingListId, localLists.lists])

  const openEditor = useCallback((sourceOrId: string) => {
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
      })
      return
    }

    // Otherwise treat as a local list ID
    setState({
      isOpen: true,
      editingListId: sourceOrId,
      editingSourceKey: null,
    })
  }, [localLists.lists])

  const openNewEditor = useCallback(() => {
    setState({
      isOpen: true,
      editingListId: null,
      editingSourceKey: null,
    })
  }, [])

  const closeEditor = useCallback(() => {
    setState({
      isOpen: false,
      editingListId: null,
      editingSourceKey: null,
    })
  }, [])

  const setActiveList = useCallback((list: LocalList) => {
    setState((s) => ({ ...s, editingListId: list.id }))
  }, [])

  return (
    <ListEditorCtx.Provider
      value={{
        ...state,
        activeList,
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
