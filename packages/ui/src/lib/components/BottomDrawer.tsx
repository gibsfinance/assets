import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'

type DrawerState = 'collapsed' | 'half' | 'full'

interface BottomDrawerProps {
  children: ReactNode
  /** Content shown in the collapsed handle bar */
  handle?: ReactNode
  /** Whether the drawer is enabled (shown) */
  enabled?: boolean
}

const COLLAPSED_HEIGHT = 48
const HALF_HEIGHT_RATIO = 0.4
const DRAG_THRESHOLD = 40

/** Cycle through drawer states on tap */
function nextState(current: DrawerState): DrawerState {
  if (current === 'collapsed') return 'half'
  if (current === 'half') return 'full'
  return 'collapsed'
}

function getTranslateY(state: DrawerState, viewportHeight: number): number {
  if (state === 'collapsed') return viewportHeight - COLLAPSED_HEIGHT
  if (state === 'half') return viewportHeight * (1 - HALF_HEIGHT_RATIO)
  return 0
}

export default function BottomDrawer({ children, handle, enabled = true }: BottomDrawerProps) {
  const [drawerState, setDrawerState] = useState<DrawerState>('collapsed')
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 800,
  )

  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const currentTranslateY = useRef(0)

  // Track viewport height changes (e.g. orientation, keyboard)
  useEffect(() => {
    function handleResize() {
      setViewportHeight(window.innerHeight)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Reset to collapsed when disabled
  useEffect(() => {
    if (!enabled) {
      setDrawerState('collapsed')
    }
  }, [enabled])

  const baseTranslateY = getTranslateY(drawerState, viewportHeight)

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      touchStartY.current = touch.clientY
      touchStartTime.current = Date.now()
      currentTranslateY.current = baseTranslateY
      setIsDragging(true)
      setDragOffset(0)
    },
    [baseTranslateY],
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return
      const touch = e.touches[0]
      if (!touch) return
      const deltaY = touch.clientY - touchStartY.current
      // Clamp so the drawer can't go above the viewport top
      const newOffset = Math.max(deltaY, -currentTranslateY.current)
      setDragOffset(newOffset)
    },
    [isDragging],
  )

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)

    const elapsed = Date.now() - touchStartTime.current
    const wasTap = Math.abs(dragOffset) < 8 && elapsed < 300

    if (wasTap) {
      setDrawerState(nextState)
      setDragOffset(0)
      return
    }

    // Determine target state based on final position + velocity
    const velocity = dragOffset / Math.max(elapsed, 1)
    const isFlickDown = velocity > 0.3
    const isFlickUp = velocity < -0.3

    const finalY = currentTranslateY.current + dragOffset

    if (isFlickUp) {
      // Flick up: go to the next higher state
      if (drawerState === 'collapsed') {
        setDrawerState('half')
      } else {
        setDrawerState('full')
      }
    } else if (isFlickDown) {
      // Flick down: go to the next lower state
      if (drawerState === 'full') {
        setDrawerState('half')
      } else {
        setDrawerState('collapsed')
      }
    } else {
      // Snap to nearest state based on position
      const fullY = getTranslateY('full', viewportHeight)
      const halfY = getTranslateY('half', viewportHeight)
      const collapsedY = getTranslateY('collapsed', viewportHeight)

      const distToFull = Math.abs(finalY - fullY)
      const distToHalf = Math.abs(finalY - halfY)
      const distToCollapsed = Math.abs(finalY - collapsedY)

      if (distToFull <= distToHalf && distToFull <= distToCollapsed) {
        setDrawerState('full')
      } else if (distToHalf <= distToCollapsed) {
        setDrawerState('half')
      } else {
        setDrawerState('collapsed')
      }
    }

    setDragOffset(0)
  }, [isDragging, dragOffset, drawerState, viewportHeight])

  const handleBackdropClick = useCallback(() => {
    setDrawerState('collapsed')
  }, [])

  if (!enabled) return null

  const translateY = isDragging
    ? Math.max(0, baseTranslateY + dragOffset)
    : baseTranslateY

  const showBackdrop = drawerState === 'full' && !isDragging

  return (
    <>
      {/* Backdrop */}
      {showBackdrop && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={handleBackdropClick}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        className="fixed inset-x-0 top-0 z-50 lg:hidden flex flex-col bg-white dark:bg-surface-base rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)]"
        style={{
          height: `${viewportHeight}px`,
          transform: `translateY(${translateY}px)`,
          transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
        }}
      >
        {/* Handle area */}
        <div
          className="flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
          style={{ touchAction: 'none' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={() => {
            if (!isDragging) setDrawerState(nextState)
          }}
        >
          {/* Drag indicator */}
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="w-9 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
          </div>
          {/* Handle content */}
          <div className="px-4 pb-2.5 min-h-[28px] flex items-center">
            {handle ?? (
              <span className="text-sm text-gray-400 dark:text-gray-500">Configure</span>
            )}
          </div>
        </div>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto overscroll-contain border-t border-border-light dark:border-border-dark">
          {children}
        </div>
      </div>
    </>
  )
}
