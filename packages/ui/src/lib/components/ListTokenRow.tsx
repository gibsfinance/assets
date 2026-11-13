import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Image from './Image'
import ImageUpload from './ImageUpload'
import type { LocalToken } from '../hooks/useLocalLists'
import { faGripVertical, faTrashCan } from '@fortawesome/free-solid-svg-icons'
import { Icon } from './Icon'

interface ListTokenRowProps {
  token: LocalToken
  onRemove: (address: string) => void
  onImageClick: (token: LocalToken) => void
  /** Called with a data URI when the user uploads a new image from the inline widget */
  onImageUpload: (token: LocalToken, dataUri: string) => void
}

export default function ListTokenRow({ token, onRemove, onImageClick, onImageUpload }: ListTokenRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${token.chainId}-${token.address}`,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 0,
    position: 'relative' as const,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 border-b border-border-strong px-4 py-2 bg-surface">
      {/* Drag handle */}
      <button
        type="button"
        className="flex-shrink-0 cursor-grab text-content-ghost hover:text-content-subtle active:cursor-grabbing"
        {...attributes}
        {...listeners}>
        <Icon icon={faGripVertical} className="text-xs" />
      </button>

      {/* Icon: inline upload when no imageUri, otherwise click-to-edit */}
      {token.imageUri ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onImageClick(token)
          }}
          className="flex-shrink-0 rounded-full ring-2 ring-transparent transition-all hover:ring-accent/40"
          title="Edit image">
          <Image
            // token.imageUri is guaranteed a truthy string here: this button only
            // renders inside the `token.imageUri ? ... : <ImageUpload />` branch above,
            // so the field can never be empty at this point. The derived-URL fallback
            // this used to carry could never run and only hid that the field is unused.
            src={token.imageUri}
            size={24}
            skeleton
            lazy
            shape="circle"
            className="rounded-full"
          />
        </button>
      ) : (
        <ImageUpload size={24} onUpload={(dataUri) => onImageUpload(token, dataUri)} />
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-content-body">{token.name || 'Unknown'}</span>
          <span className="ml-auto flex-shrink-0 text-xs text-content-faint">{token.symbol || '???'}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] text-content-faint">
            {token.address.slice(0, 10)}...{token.address.slice(-6)}
          </span>
          <span className="text-[10px] text-content-ghost">
            {token.decimals}d · chain {token.chainId}
          </span>
        </div>
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={() => onRemove(token.address)}
        className="flex-shrink-0 rounded p-1 text-content-ghost transition-colors hover:bg-danger-soft hover:text-danger-hover"
        title="Remove token">
        <Icon icon={faTrashCan} className="text-xs" />
      </button>
    </div>
  )
}
