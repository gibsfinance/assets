import { useState, useMemo, useCallback, useRef } from 'react'
import {
  Menu,
  MenuButton,
  MenuItems,
  MenuItem,
  Popover,
  PopoverButton,
  PopoverPanel,
} from '@headlessui/react'
import { useStudio } from '../contexts/StudioContext'
import { useTheme } from '../contexts/ThemeContext'
import { getApiUrl } from '../utils'
import { getNetworkName } from '../utils/network-name'
import { badgePositionToCSS } from '../utils/badge-position'
import BadgeConfigurator from './BadgeConfigurator'
import ListResolutionOrder from './ListResolutionOrder'
import CodeOutput from './CodeOutput'
import Image from './Image'

// ---------------------------------------------------------------------------
// Shadow + shape helpers
// ---------------------------------------------------------------------------

const SHADOW_MAP: Record<string, string> = {
  none: 'none',
  subtle: '0 1px 3px rgba(0,0,0,0.12)',
  medium: '0 4px 12px rgba(0,0,0,0.15)',
  strong: '0 8px 24px rgba(0,0,0,0.2)',
}

function shapeToRadius(shape: string, borderRadius: number): string {
  if (shape === 'circle') return '50%'
  if (shape === 'rounded') return `${borderRadius}px`
  return '0'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHAPE_OPTIONS = [
  { value: 'circle' as const, label: 'Circle' },
  { value: 'rounded' as const, label: 'Rounded' },
  { value: 'square' as const, label: 'Square' },
] as const

const SHADOW_OPTIONS = [
  { value: 'none' as const, label: 'None' },
  { value: 'subtle' as const, label: 'Subtle' },
  { value: 'medium' as const, label: 'Medium' },
  { value: 'strong' as const, label: 'Strong' },
] as const

const BACKGROUND_SWATCHES = [
  { value: 'transparent', label: 'Transparent' },
  { value: '#000000', label: 'Black' },
  { value: '#ffffff', label: 'White' },
] as const

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4

// ---------------------------------------------------------------------------
// Toolbar: Size inputs
// ---------------------------------------------------------------------------

function SizeControl() {
  const { appearance, updateAppearance } = useStudio()
  const [aspectLinked, setAspectLinked] = useState(true)

  const handleWidthChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value)
      if (aspectLinked) {
        updateAppearance({ width: value, height: value })
        return
      }
      updateAppearance({ width: value })
    },
    [aspectLinked, updateAppearance],
  )

  const handleHeightChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value)
      if (aspectLinked) {
        updateAppearance({ width: value, height: value })
        return
      }
      updateAppearance({ height: value })
    },
    [aspectLinked, updateAppearance],
  )

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-medium text-gray-400 dark:text-white/40">W</span>
      <input
        type="number"
        min={16}
        max={512}
        value={appearance.width}
        onChange={handleWidthChange}
        className="w-14 rounded-md border border-border-light bg-gray-50 px-1.5 py-1 text-center text-xs text-gray-700 focus:border-accent-500 focus:outline-none dark:border-border-dark dark:bg-surface-2 dark:text-white/80"
      />
      <button
        type="button"
        onClick={() => setAspectLinked((v) => !v)}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
          aspectLinked
            ? 'bg-accent-500/15 text-accent-500'
            : 'bg-gray-100 text-gray-400 hover:text-gray-600 dark:bg-surface-2 dark:text-white/30 dark:hover:text-white/50'
        }`}
        aria-label={aspectLinked ? 'Unlink aspect ratio' : 'Link aspect ratio'}
      >
        <i className={`fas ${aspectLinked ? 'fa-link' : 'fa-link-slash'} text-[9px]`} />
      </button>
      <span className="text-[10px] font-medium text-gray-400 dark:text-white/40">H</span>
      <input
        type="number"
        min={16}
        max={512}
        value={appearance.height}
        onChange={handleHeightChange}
        className="w-14 rounded-md border border-border-light bg-gray-50 px-1.5 py-1 text-center text-xs text-gray-700 focus:border-accent-500 focus:outline-none dark:border-border-dark dark:bg-surface-2 dark:text-white/80"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toolbar: Padding control
// ---------------------------------------------------------------------------

function PaddingControl() {
  const { appearance, updateAppearance } = useStudio()
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-medium text-gray-400 dark:text-white/40">Pad</span>
      <input
        type="number"
        min={0}
        max={64}
        value={appearance.padding}
        onChange={(e) => updateAppearance({ padding: Number(e.target.value) })}
        className="w-12 rounded-md border border-border-light bg-gray-50 px-1.5 py-1 text-center text-xs text-gray-700 focus:border-accent-500 focus:outline-none dark:border-border-dark dark:bg-surface-2 dark:text-white/80"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toolbar: Shape dropdown
// ---------------------------------------------------------------------------

function ShapeDropdown() {
  const { appearance, updateAppearance } = useStudio()

  const currentLabel = SHAPE_OPTIONS.find((o) => o.value === appearance.shape)?.label ?? 'Circle'

  const handleBorderRadiusChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updateAppearance({ borderRadius: Number(event.target.value) })
    },
    [updateAppearance],
  )

  return (
    <div className="flex items-center gap-1">
      <Menu>
        <MenuButton className="flex items-center gap-1.5 rounded-md border border-border-light bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-border-dark dark:bg-surface-2 dark:text-white/80 dark:hover:bg-surface-3">
          {currentLabel}
          <i className="fas fa-chevron-down text-[8px] text-gray-400 dark:text-white/40" />
        </MenuButton>
        <MenuItems
          anchor="bottom start"
          className="z-50 mt-1 w-32 rounded-lg border border-border-light bg-white p-1 shadow-lg dark:border-border-dark dark:bg-surface-2"
        >
          {SHAPE_OPTIONS.map((option) => (
            <MenuItem key={option.value}>
              <button
                type="button"
                onClick={() => updateAppearance({ shape: option.value })}
                className={`flex w-full items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  appearance.shape === option.value
                    ? 'bg-accent-500/10 text-accent-500'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-white/70 dark:hover:bg-surface-3'
                }`}
              >
                {option.label}
              </button>
            </MenuItem>
          ))}
        </MenuItems>
      </Menu>

      {appearance.shape === 'rounded' && (
        <input
          type="number"
          min={0}
          max={Math.min(appearance.width, appearance.height) / 2}
          value={appearance.borderRadius}
          onChange={handleBorderRadiusChange}
          className="w-12 rounded-md border border-border-light bg-gray-50 px-1.5 py-1 text-center text-xs text-gray-700 focus:border-accent-500 focus:outline-none dark:border-border-dark dark:bg-surface-2 dark:text-white/80"
          title="Border radius"
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toolbar: Shadow dropdown
// ---------------------------------------------------------------------------

function ShadowDropdown() {
  const { appearance, updateAppearance } = useStudio()

  const currentLabel = SHADOW_OPTIONS.find((o) => o.value === appearance.shadow)?.label ?? 'None'

  return (
    <Menu>
      <MenuButton className="flex items-center gap-1.5 rounded-md border border-border-light bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-border-dark dark:bg-surface-2 dark:text-white/80 dark:hover:bg-surface-3">
        {currentLabel}
        <i className="fas fa-chevron-down text-[8px] text-gray-400 dark:text-white/40" />
      </MenuButton>
      <MenuItems
        anchor="bottom start"
        className="z-50 mt-1 w-32 rounded-lg border border-border-light bg-white p-1 shadow-lg dark:border-border-dark dark:bg-surface-2"
      >
        {SHADOW_OPTIONS.map((option) => (
          <MenuItem key={option.value}>
            <button
              type="button"
              onClick={() => updateAppearance({ shadow: option.value })}
              className={`flex w-full items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                appearance.shadow === option.value
                  ? 'bg-accent-500/10 text-accent-500'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-white/70 dark:hover:bg-surface-3'
              }`}
            >
              {option.label}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  )
}

// ---------------------------------------------------------------------------
// Toolbar: Background popover
// ---------------------------------------------------------------------------

function BackgroundPopover() {
  const { appearance, updateAppearance } = useStudio()

  const handleCustomColorChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updateAppearance({ backgroundColor: event.target.value })
    },
    [updateAppearance],
  )

  const isCustomBackground = !BACKGROUND_SWATCHES.some(
    (s) => s.value === appearance.backgroundColor,
  )

  /** Inline style for the swatch button showing the current color */
  const swatchStyle =
    appearance.backgroundColor === 'transparent'
      ? {
          backgroundImage:
            'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
          backgroundSize: '6px 6px',
          backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px',
        }
      : { backgroundColor: appearance.backgroundColor }

  return (
    <Popover className="relative">
      <PopoverButton
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-light transition-colors hover:border-gray-400 dark:border-border-dark dark:hover:border-white/30"
        style={swatchStyle}
        aria-label="Background color"
      />
      <PopoverPanel
        anchor="bottom start"
        className="z-50 mt-2 rounded-lg border border-border-light bg-white p-3 shadow-lg dark:border-border-dark dark:bg-surface-2"
      >
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-white/40">
          Background
        </p>
        <div className="flex items-center gap-2">
          {BACKGROUND_SWATCHES.map((swatch) => (
            <button
              key={swatch.value}
              type="button"
              onClick={() => updateAppearance({ backgroundColor: swatch.value })}
              aria-label={swatch.label}
              className={`relative h-7 w-7 shrink-0 rounded-md border-2 transition-all ${
                appearance.backgroundColor === swatch.value
                  ? 'border-accent-500 ring-2 ring-accent-500/30'
                  : 'border-border-light hover:border-gray-400 dark:border-border-dark dark:hover:border-white/30'
              }`}
              style={
                swatch.value === 'transparent'
                  ? {
                      backgroundImage:
                        'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                      backgroundSize: '6px 6px',
                      backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px',
                    }
                  : { backgroundColor: swatch.value }
              }
            />
          ))}

          <div className="relative">
            <input
              type="color"
              value={isCustomBackground ? appearance.backgroundColor : '#666666'}
              onChange={handleCustomColorChange}
              className="h-7 w-7 cursor-pointer rounded-md border-2 border-border-light bg-gray-50 p-0.5 dark:border-border-dark dark:bg-surface-3"
              aria-label="Custom background color"
            />
          </div>
        </div>

        {isCustomBackground && (
          <span className="mt-1.5 block font-mono text-[10px] text-gray-400 dark:text-white/40">
            {appearance.backgroundColor}
          </span>
        )}

        {appearance.backgroundColor !== 'transparent' && appearance.padding === 0 && (
          <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 p-2 text-[10px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            <i className="fas fa-lightbulb mt-0.5 flex-shrink-0 text-[9px]" />
            <span>
              Background won't be visible without padding.{' '}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => updateAppearance({ padding: 8 })}
              >
                Add padding
              </button>
              {appearance.shape === 'square' && (
                <>
                  {' or '}
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => updateAppearance({ shape: 'rounded', borderRadius: 12 })}
                  >
                    round corners
                  </button>
                </>
              )}
            </span>
          </div>
        )}
      </PopoverPanel>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Toolbar: Badge toggle + popover
// ---------------------------------------------------------------------------

function BadgePopover() {
  const { badge, updateBadge } = useStudio()

  return (
    <Popover className="relative">
      <PopoverButton
        className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
          badge.enabled
            ? 'border-accent-500/30 bg-accent-500/10 text-accent-500'
            : 'border-border-light bg-gray-50 text-gray-500 hover:bg-gray-100 dark:border-border-dark dark:bg-surface-2 dark:text-white/50 dark:hover:bg-surface-3'
        }`}
        aria-label="Badge settings"
      >
        <i className="fas fa-link text-[10px]" />
        <span className="hidden sm:inline">Badge</span>
      </PopoverButton>
      <PopoverPanel
        anchor="bottom start"
        className="z-50 mt-2 w-80 rounded-lg border border-border-light bg-white p-4 shadow-lg dark:border-border-dark dark:bg-surface-1"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-800 dark:text-white/90">
            Network Badge
          </span>
          <button
            type="button"
            onClick={() => updateBadge({ enabled: !badge.enabled })}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              badge.enabled
                ? 'bg-accent-500/20'
                : 'bg-gray-200 dark:bg-surface-3'
            }`}
            aria-label={badge.enabled ? 'Disable badge' : 'Enable badge'}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-all ${
                badge.enabled
                  ? 'translate-x-4 bg-accent-500'
                  : 'bg-gray-400 dark:bg-white/40'
              }`}
            />
          </button>
        </div>
        <BadgeConfigurator />
      </PopoverPanel>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Toolbar: Resolution Order popover
// ---------------------------------------------------------------------------

function ResolutionOrderPopover() {
  return (
    <Popover className="relative">
      <PopoverButton
        className="flex h-7 items-center gap-1.5 rounded-md border border-border-light bg-gray-50 px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:border-border-dark dark:bg-surface-2 dark:text-white/50 dark:hover:bg-surface-3"
        aria-label="Resolution order"
      >
        <i className="fas fa-layer-group text-[10px]" />
        <span className="hidden sm:inline">Order</span>
      </PopoverButton>
      <PopoverPanel
        anchor="bottom start"
        className="z-50 mt-2 w-72 rounded-lg border border-border-light bg-white shadow-lg dark:border-border-dark dark:bg-surface-1"
      >
        <ListResolutionOrder />
      </PopoverPanel>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Toolbar: Code popover
// ---------------------------------------------------------------------------

function CodePopover() {
  return (
    <Popover className="relative">
      <PopoverButton
        className="flex h-7 items-center gap-1.5 rounded-md border border-border-light bg-gray-50 px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:border-border-dark dark:bg-surface-2 dark:text-white/50 dark:hover:bg-surface-3"
        aria-label="Code output"
      >
        <i className="fas fa-code text-[10px]" />
        <span className="hidden sm:inline">Code</span>
      </PopoverButton>
      <PopoverPanel
        anchor="bottom end"
        className="z-50 mt-2 w-[28rem] rounded-lg border border-border-light bg-white p-4 shadow-lg dark:border-border-dark dark:bg-surface-1"
      >
        <CodeOutput />
      </PopoverPanel>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Toolbar bar (assembled)
// ---------------------------------------------------------------------------

function Toolbar() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border-light bg-white px-4 py-3 dark:border-border-dark dark:bg-surface-base">
      <SizeControl />
      <PaddingControl />

      <div className="h-4 w-px bg-border-light dark:bg-border-dark" />

      <ShapeDropdown />

      <div className="h-4 w-px bg-border-light dark:bg-border-dark" />

      <ShadowDropdown />

      <div className="h-4 w-px bg-border-light dark:bg-border-dark" />

      <BackgroundPopover />

      <div className="h-4 w-px bg-border-light dark:bg-border-dark" />

      <BadgePopover />
      <ResolutionOrderPopover />
      <CodePopover />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Infinite canvas
// ---------------------------------------------------------------------------

interface CanvasTransform {
  x: number
  y: number
  zoom: number
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Checkerboard SVG data URI for a transparent-style canvas background */
const CHECKERBOARD_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23e5e7eb'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23e5e7eb'/%3E%3C/svg%3E")`
const CHECKERBOARD_SVG_DARK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='%23111113'/%3E%3Crect width='10' height='10' fill='%231a1a1e'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%231a1a1e'/%3E%3C/svg%3E")`

function InfiniteCanvas() {
  const { selectedToken, selectedChainId, resolutionOrder, appearance, badge } = useStudio()

  const containerRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState<CanvasTransform>({ x: 0, y: 0, zoom: 1 })
  const isDragging = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })

  const { isDark } = useTheme()

  // Build image URLs
  const imageUrl = useMemo(() => {
    if (!selectedToken || !selectedChainId) return ''
    if (resolutionOrder && resolutionOrder.length > 0) {
      return getApiUrl(
        `/image/fallback/${resolutionOrder.join(',')}/${selectedChainId}/${selectedToken.address}`,
      )
    }
    return getApiUrl(`/image/${selectedChainId}/${selectedToken.address}`)
  }, [selectedToken, selectedChainId, resolutionOrder])

  const networkUrl = useMemo(
    () => getApiUrl(`/image/${selectedChainId ?? '1'}`),
    [selectedChainId],
  )

  const networkName = useMemo(
    () => getNetworkName(selectedChainId ?? '1'),
    [selectedChainId],
  )

  // Appearance computations
  const { width, height, shape, borderRadius, padding, shadow, backgroundColor } = appearance
  const borderRadiusCSS = shapeToRadius(shape, borderRadius)
  const boxShadow = SHADOW_MAP[shadow] ?? 'none'

  const badgePosition = useMemo(() => {
    if (!badge.enabled) return null
    return badgePositionToCSS(width, badge.angleDeg, badge.sizeRatio, badge.overlap)
  }, [badge.enabled, badge.angleDeg, badge.sizeRatio, badge.overlap, width])

  const tokenName = selectedToken?.name ?? 'Token'
  const hasToken = selectedToken !== null

  // ---- Pan handlers ----
  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    isDragging.current = true
    lastPointer.current = { x: event.clientX, y: event.clientY }
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (!isDragging.current) return
    const dx = event.clientX - lastPointer.current.x
    const dy = event.clientY - lastPointer.current.y
    lastPointer.current = { x: event.clientX, y: event.clientY }
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }))
  }, [])

  const handlePointerUp = useCallback(() => {
    isDragging.current = false
  }, [])

  // ---- Zoom handler ----
  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault()
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top

    setTransform((prev) => {
      const delta = -event.deltaY * 0.001
      const newZoom = clampZoom(prev.zoom * (1 + delta))
      const scale = newZoom / prev.zoom

      // Zoom towards the pointer position
      const newX = pointerX - scale * (pointerX - prev.x)
      const newY = pointerY - scale * (pointerY - prev.y)

      return { x: newX, y: newY, zoom: newZoom }
    })
  }, [])

  // ---- Reset view ----
  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, zoom: 1 })
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative flex-1 cursor-grab select-none overflow-hidden active:cursor-grabbing"
      style={{
        backgroundImage: isDark ? CHECKERBOARD_SVG_DARK : CHECKERBOARD_SVG,
        backgroundSize: '20px 20px',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* Canvas content */}
      <div
        className="absolute inset-0 flex items-center justify-center"
      >
        <div style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
        }}>

        {!hasToken && (
          <div className="flex flex-col items-center gap-3 pointer-events-none">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100 dark:bg-surface-2">
              <i className="fas fa-coins text-2xl text-gray-300 dark:text-white/10" />
            </div>
            <p className="text-sm font-medium text-gray-400 dark:text-white/30">
              Select a token to preview
            </p>
          </div>
        )}

        {hasToken && (
          <div
            className="relative inline-flex items-center justify-center"
            style={{
              borderRadius: borderRadiusCSS,
              boxShadow: boxShadow !== 'none' ? boxShadow : undefined,
              backgroundColor: backgroundColor !== 'transparent' ? backgroundColor : undefined,
            }}
          >
            <Image
              src={imageUrl}
              alt={tokenName}
              skeleton
              shape={shape === 'circle' ? 'circle' : 'rect'}
              width={width}
              height={height}
              style={{
                margin: padding > 0 ? padding : undefined,
                borderRadius: borderRadiusCSS,
              }}
            />

            {badge.enabled && badgePosition && (() => {
              const badgeShape = badge.badgeShape ?? 'circle'
              const badgePadding = badge.badgePadding ?? 0
              const badgeBackground = badge.badgeBackground ?? 'transparent'
              const badgeBorderRadius = badgeShape === 'circle' ? '50%' : '0'
              return (
                <div
                  style={{
                    position: 'absolute',
                    top: Math.round(badgePosition.top),
                    left: Math.round(badgePosition.left),
                    borderRadius: badgeBorderRadius,
                    padding: badgePadding > 0 ? badgePadding : undefined,
                    backgroundColor: badgeBackground !== 'transparent' ? badgeBackground : undefined,
                    ...(badge.ringEnabled
                      ? { border: `${badge.ringThickness}px solid ${badge.ringColor}` }
                      : {}),
                  }}
                >
                  <Image
                    src={networkUrl}
                    alt={networkName}
                    skeleton
                    shape={badgeShape === 'circle' ? 'circle' : 'rect'}
                    width={Math.round(badgePosition.badgeSize)}
                    height={Math.round(badgePosition.badgeSize)}
                    style={{
                      borderRadius: badgeBorderRadius,
                      display: 'block',
                    }}
                  />
                </div>
              )
            })()}
          </div>
        )}
        </div>
      </div>

      {/* Zoom indicator + reset */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
        <span className="rounded-md bg-white/80 px-2 py-0.5 font-mono text-[10px] text-gray-600 backdrop-blur dark:bg-surface-2/80 dark:text-white/50">
          {Math.round(transform.zoom * 100)}%
        </span>
        {(transform.x !== 0 || transform.y !== 0 || transform.zoom !== 1) && (
          <button
            type="button"
            onClick={resetView}
            className="rounded-md bg-white/80 px-2 py-0.5 text-[10px] font-medium text-gray-500 backdrop-blur transition-colors hover:text-gray-700 dark:bg-surface-2/80 dark:text-white/40 dark:hover:text-white/60"
            aria-label="Reset canvas view"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * StudioConfigurator -- compact toolbar at top with dropdowns/popovers,
 * infinite draggable + zoomable canvas below showing the token preview.
 *
 * Reads/writes all state via `useStudio()` context.
 */
export default function StudioConfigurator() {
  return (
    <div className="flex h-full flex-col overflow-x-hidden">
      <Toolbar />
      <InfiniteCanvas />
    </div>
  )
}
