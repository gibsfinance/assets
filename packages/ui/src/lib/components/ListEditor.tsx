import { useListEditor } from '../contexts/ListEditorContext'

export default function ListEditor() {
  const { editingList, closeEditor } = useListEditor()

  return (
    <div className="flex h-full flex-col bg-white dark:bg-surface-base">
      <div className="flex items-center justify-between border-b border-border-light px-4 py-3 dark:border-border-dark">
        <div className="flex items-center gap-3">
          <h2 className="font-heading text-lg font-bold text-gray-900 dark:text-white">
            List Editor
          </h2>
          {editingList && (
            <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-xs text-accent-500">
              {editingList}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={closeEditor}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-white/40 dark:hover:bg-surface-2 dark:hover:text-white/80"
          title="Close editor"
        >
          <i className="fas fa-times" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center p-8 text-center text-gray-400 dark:text-white/30">
        <div>
          <i className="fas fa-list-ul mb-3 text-3xl" />
          <p className="text-sm">List editor coming soon</p>
          {editingList && (
            <p className="mt-1 text-xs text-gray-300 dark:text-white/20">
              Editing: {editingList}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
