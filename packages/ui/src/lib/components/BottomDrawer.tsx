import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'

export type DrawerState = 'collapsed' | 'half' | 'full'

interface BottomDrawerProps {
  children: ReactNode
  /** Content shown in the collapsed handle bar */
  handle?: ReactNode
  /** Whether the drawer is enabled (shown) */
  enabled?: boolean
}

export const COLLAPSED_HEIGHT = 48
export const HALF_HEIGHT_RATIO = 0.4

/** Cycle through drawer states on tap */
export function nextState(current: DrawerState): DrawerState {
  if (current === 'collapsed') return 'half'
  if (current === 'half') return 'full'
  return 'collapsed'
}

export function getTranslateY(state: DrawerState, viewportHeight: number): number {
  if (state === 'collapsed') return viewportHeight - COLLAPSED_HEIGHT
  if (state === 'half') return viewportHeight * (1 - HALF_HEIGHT_RATIO)
  return 0
}

/** Determine target state based on flick velocity */
export function resolveFlickState(
  velocity: number,
  currentState: DrawerState,
): DrawerState | null {
  if (velocity < -0.3) {
    return currentState === 'collapsed' ? 'half' : 'full'
  }
  if (velocity > 0.3) {
    return currentState === 'full' ? 'half' : 'collapsed'
  }
  return null // not a flick
}

/** Snap to nearest state based on final Y position */
export function snapToNearestState(finalY: number, viewportHeight: number): DrawerState {
  const fullY = getTranslateY('full', viewportHeight)
  const halfY = getTranslateY('half', viewportHeight)
  const collapsedY = getTranslateY('collapsed', viewportHeight)

  const distToFull = Math.abs(finalY - fullY)
  const distToHalf = Math.abs(finalY - halfY)
  const distToCollapsed = Math.abs(finalY - collapsedY)

  if (distToFull <= distToHalf && distToFull <= distToCollapsed) return 'full'
  if (distToHalf <= distToCollapsed) return 'half'
  return 'collapsed'
}

export type TouchEndResult =
  | { type: 'tap' }
  | { type: 'resolved'; state: DrawerState }

/** Determine the drawer state after a touch ends — tap, flick, or snap. */
export function resolveTouchEndState(
  dragOffset: number,
  elapsed: number,
  currentState: DrawerState,
  currentTranslateY: number,
  viewportHeight: number,
): TouchEndResult {
  const wasTap = Math.abs(dragOffset) < 8 && elapsed < 300
  if (wasTap) return { type: 'tap' }

  const velocity = dragOffset / Math.max(elapsed, 1)
  const finalY = currentTranslateY + dragOffset

  const flickTarget = resolveFlickState(velocity, currentState)
  if (flickTarget !== null) return { type: 'resolved', state: flickTarget }
  return { type: 'resolved', state: snapToNearestState(finalY, viewportHeight) }
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
  /** Prevents onClick from firing after touchEnd (double-cycle on mobile) */
  const wasTouched = useRef(false)

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

  // Lock body scroll when drawer is fully open
  useEffect(() => {
    if (drawerState === 'full') {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [drawerState])

  // Escape key to collapse
  useEffect(() => {
    if (drawerState === 'collapsed') return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerState('collapsed')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [drawerState])

  const baseTranslateY = getTranslateY(drawerState, viewportHeight)

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      wasTouched.current = true
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
      const newOffset = Math.max(deltaY, -currentTranslateY.current)
      setDragOffset(newOffset)
    },
    [isDragging],
  )

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)

    // Reset wasTouched after the click event has had a chance to fire
    requestAnimationFrame(() => { wasTouched.current = false })

    const elapsed = Date.now() - touchStartTime.current
    const result = resolveTouchEndState(
      dragOffset, elapsed, drawerState,
      currentTranslateY.current, viewportHeight,
    )

    if (result.type === 'tap') {
      setDrawerState(nextState)
      setDragOffset(0)
      return
    }

    setDrawerState(result.state)
    setDragOffset(0)
  }, [isDragging, dragOffset, drawerState, viewportHeight])

  const handleClick = useCallback(() => {
    // Skip if this click was preceded by a touch (already handled in touchEnd)
    if (wasTouched.current) return
    setDrawerState(nextState)
  }, [])

  const handleBackdropClick = useCallback(() => {
    setDrawerState('collapsed')
  }, [])

  if (!enabled) return null

  const translateY = isDragging
    ? Math.max(0, baseTranslateY + dragOffset)
    : baseTranslateY

  const isOpen = drawerState !== 'collapsed'
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
        role="dialog"
        aria-modal={isOpen}
        aria-label="Token configurator"
        className="fixed inset-x-0 top-0 z-50 lg:hidden flex flex-col bg-white dark:bg-surface-base rounded-t-lg shadow-[0_-4px_20px_rgba(0,0,0,0.15)]"
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
          onClick={handleClick}
          role="button"
          tabIndex={0}
          aria-label={isOpen ? 'Collapse drawer' : 'Expand drawer'}
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
