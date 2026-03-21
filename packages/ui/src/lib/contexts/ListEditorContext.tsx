import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface ListEditorState {
  isOpen: boolean
  editingList: string | null
}

interface ListEditorContextValue extends ListEditorState {
  openEditor: (sourceList: string) => void
  closeEditor: () => void
}

const ListEditorCtx = createContext<ListEditorContextValue | null>(null)

export function ListEditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ListEditorState>({
    isOpen: false,
    editingList: null,
  })

  const openEditor = useCallback((sourceList: string) => {
    setState({ isOpen: true, editingList: sourceList })
  }, [])

  const closeEditor = useCallback(() => {
    setState({ isOpen: false, editingList: null })
  }, [])

  return (
    <ListEditorCtx.Provider value={{ ...state, openEditor, closeEditor }}>
      {children}
    </ListEditorCtx.Provider>
  )
}

export function useListEditor(): ListEditorContextValue {
  const ctx = useContext(ListEditorCtx)
  if (!ctx) throw new Error('useListEditor must be used within ListEditorProvider')
  return ctx
}
