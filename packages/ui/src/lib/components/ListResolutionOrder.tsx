import { useState, useCallback, useRef } from 'react'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { useStudio } from '../contexts/StudioContext'
import { isDefaultOrder, reorderArray, DEFAULT_PROVIDERS } from '../utils/list-order'

interface ProviderRowProps {
  provider: string
  index: number
  isSelected: boolean
  isDragOver: boolean
  isDragging: boolean
  onDragStart: (index: number) => void
  onDragOver: (event: React.DragEvent, index: number) => void
  onDrop: (index: number) => void
  onDragEnd: () => void
  onClick: (index: number) => void
  onKeyDown: (event: React.KeyboardEvent, index: number) => void
}

function ProviderRow({
  provider,
  index,
  isSelected,
  isDragOver,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onClick,
  onKeyDown,
}: ProviderRowProps) {
  return (
    <div
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      draggable
      className={[
        'flex cursor-grab items-center gap-3 rounded-lg px-3 py-2 transition-all select-none',
        'bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 dark:bg-surface-2',
        isDragging ? 'opacity-40' : 'opacity-100',
        isDragOver ? 'border border-accent-500 bg-accent-500/5' : 'border border-transparent',
        isSelected ? 'ring-2 ring-accent-500/70' : '',
      ].join(' ')}
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      onDragEnd={onDragEnd}
      onClick={() => onClick(index)}
      onKeyDown={(e) => onKeyDown(e, index)}
    >
      {/* Grip handle */}
      <span
        className="cursor-grab text-gray-300 select-none dark:text-white/30"
        aria-hidden="true"
      >
        &#x2807;
      </span>

      {/* Provider name */}
      <span className="flex-1 text-sm font-medium capitalize text-gray-700 dark:text-white/80">
        {provider}
      </span>

      {/* Position badge */}
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-[10px] font-mono text-gray-500 dark:bg-surface-3 dark:text-white/40">
        {index + 1}
      </span>
    </div>
  )
}

/**
 * ListResolutionOrder — collapsible drag-and-drop list for setting provider image priority.
 *
 * Reads/writes resolutionOrder via useStudio(). When the order matches the server
 * default, null is passed to indicate "use server default" (cleaner URLs).
 */
export default function ListResolutionOrder() {
  const { resolutionOrder, setResolutionOrder } = useStudio()

  // Local ordering state — initialized from context or default
  const [providers, setProviders] = useState<string[]>(
    () => resolutionOrder ?? [...DEFAULT_PROVIDERS],
  )

  // Keyboard navigation: index of the currently "selected" item for keyboard moves
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  // Drag state
  const dragSourceIndex = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // ---------------------------------------------------------------------------
  // Drag handlers
  // ---------------------------------------------------------------------------

  const handleDragStart = useCallback((index: number) => {
    dragSourceIndex.current = index
  }, [])

  const handleDragOver = useCallback((event: React.DragEvent, index: number) => {
    event.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback(
    (targetIndex: number) => {
      const sourceIndex = dragSourceIndex.current
      if (sourceIndex === null || sourceIndex === targetIndex) {
        setDragOverIndex(null)
        return
      }

      const reordered = reorderArray(providers, sourceIndex, targetIndex)
      setProviders(reordered)
      setResolutionOrder(isDefaultOrder(reordered) ? null : reordered)
      setDragOverIndex(null)
      dragSourceIndex.current = null
    },
    [providers, setResolutionOrder],
  )

  const handleDragEnd = useCallback(() => {
    dragSourceIndex.current = null
    setDragOverIndex(null)
  }, [])

  // ---------------------------------------------------------------------------
  // Keyboard handlers
  // ---------------------------------------------------------------------------

  const handleClick = useCallback((index: number) => {
    setSelectedIndex((prev) => (prev === index ? null : index))
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      if (event.key === 'Enter') {
        // Toggle selection
        setSelectedIndex((prev) => (prev === index ? null : index))
        return
      }

      if (selectedIndex !== index) return

      const moveItem = (from: number, direction: -1 | 1) => {
        const to = from + direction
        if (to < 0 || to >= providers.length) return

        event.preventDefault()
        const reordered = reorderArray(providers, from, to)
        setProviders(reordered)
        setSelectedIndex(to)
        setResolutionOrder(isDefaultOrder(reordered) ? null : reordered)
      }

      if (event.key === 'ArrowUp') {
        moveItem(index, -1)
      } else if (event.key === 'ArrowDown') {
        moveItem(index, 1)
      } else if (event.key === 'Escape') {
        setSelectedIndex(null)
      }
    },
    [selectedIndex, providers, setResolutionOrder],
  )

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  const handleReset = useCallback(() => {
    setProviders([...DEFAULT_PROVIDERS])
    setSelectedIndex(null)
    setResolutionOrder(null)
  }, [setResolutionOrder])

  const isDefault = isDefaultOrder(providers)

  return (
    <Disclosure>
      {({ open }) => (
        <div className="elevated-card overflow-hidden">
          {/* Toggle button */}
          <DisclosureButton className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <i className="fas fa-layer-group text-xs text-accent-500" />
              <span className="font-heading text-sm font-semibold text-gray-800 dark:text-white/90">
                Resolution Order
              </span>
              {!isDefault && (
                <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-medium text-accent-500">
                  Custom
                </span>
              )}
            </div>
            <i
              className={`fas fa-chevron-down text-xs text-gray-400 transition-transform duration-200 dark:text-white/40 ${
                open ? 'rotate-180' : ''
              }`}
            />
          </DisclosureButton>

          {/* Panel */}
          <DisclosurePanel>
            <div className="flex flex-col gap-1.5 px-4 pb-4 pt-1">
              {/* Instruction hint */}
              <p className="mb-1 text-[11px] text-gray-400 dark:text-white/30">
                Drag or use{' '}
                <kbd className="rounded border border-gray-200 bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:border-white/10 dark:bg-surface-3">
                  Enter
                </kbd>{' '}
                to select, then{' '}
                <kbd className="rounded border border-gray-200 bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:border-white/10 dark:bg-surface-3">
                  ↑↓
                </kbd>{' '}
                to move.
              </p>

              {/* Provider list */}
              <div
                role="listbox"
                aria-label="Provider resolution order"
                className="flex flex-col gap-1"
              >
                {providers.map((provider, index) => (
                  <ProviderRow
                    key={provider}
                    provider={provider}
                    index={index}
                    isSelected={selectedIndex === index}
                    isDragOver={dragOverIndex === index}
                    isDragging={dragSourceIndex.current === index}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onClick={handleClick}
                    onKeyDown={handleKeyDown}
                  />
                ))}
              </div>

              {/* Reset button */}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={isDefault}
                  onClick={handleReset}
                  className={[
                    'btn-ghost px-3 py-1.5 text-xs transition-opacity',
                    isDefault ? 'pointer-events-none opacity-30' : '',
                  ].join(' ')}
                >
                  <i className="fas fa-rotate-left mr-1.5 text-[10px]" />
                  Reset to default
                </button>
              </div>
            </div>
          </DisclosurePanel>
        </div>
      )}
    </Disclosure>
  )
}
