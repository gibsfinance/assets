import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Image from './Image'
import ImageUpload from './ImageUpload'
import { getApiUrl } from '../utils'
import type { LocalToken } from '../hooks/useLocalLists'

interface ListTokenRowProps {
  token: LocalToken
  onRemove: (address: string) => void
  onImageClick: (token: LocalToken) => void
  /** Called with a data URI when the user uploads a new image from the inline widget */
  onImageUpload: (token: LocalToken, dataUri: string) => void
}

export default function ListTokenRow({
  token,
  onRemove,
  onImageClick,
  onImageUpload,
}: ListTokenRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${token.chainId}-${token.address}`,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 border-b border-gray-100 px-4 py-2 dark:border-surface-3"
    >
      {/* Drag handle */}
      <button
        type="button"
        className="flex-shrink-0 cursor-grab text-gray-300 hover:text-gray-500 active:cursor-grabbing dark:text-white/20 dark:hover:text-white/50"
        {...attributes}
        {...listeners}
      >
        <i className="fas fa-grip-vertical text-xs" />
      </button>

      {/* Icon: inline upload when no imageUri, otherwise click-to-edit */}
      {token.imageUri ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onImageClick(token)
          }}
          className="flex-shrink-0 rounded-full ring-2 ring-transparent transition-all hover:ring-accent-500/40"
          title="Edit image"
        >
          <Image
            src={token.imageUri || getApiUrl(`/image/${token.chainId}/${token.address}`)}
            size={24}
            skeleton
            lazy
            shape="circle"
            className="rounded-full"
          />
        </button>
      ) : (
        <ImageUpload
          size={24}
          onUpload={(dataUri) => onImageUpload(token, dataUri)}
        />
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between">
          <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
            {token.name || 'Unknown'}
          </span>
          <span className="flex-shrink-0 text-xs text-gray-400 dark:text-white/40">
            {token.symbol || '???'}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] text-gray-400 dark:text-white/30">
            {token.address.slice(0, 10)}...{token.address.slice(-6)}
          </span>
          <span className="text-[10px] text-gray-300 dark:text-white/20">
            {token.decimals}d · chain {token.chainId}
          </span>
        </div>
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={() => onRemove(token.address)}
        className="flex-shrink-0 rounded p-1 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-white/20 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        title="Remove token"
      >
        <i className="fas fa-trash-alt text-xs" />
      </button>
    </div>
  )
}
