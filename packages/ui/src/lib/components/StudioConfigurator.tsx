import { useState, useMemo, useCallback } from 'react'
import { useStudio } from '../contexts/StudioContext'
import { useImageMetadata } from '../hooks/useImageMetadata'
import { getApiUrl } from '../utils'
import { getNetworkName } from '../utils/network-name'
import { badgePositionToCSS } from '../utils/badge-position'
import BadgeConfigurator from './BadgeConfigurator'
import ListResolutionOrder from './ListResolutionOrder'
import CodeOutput from './CodeOutput'

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
// Section heading
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-wide text-white/40">
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Shape button icons (inline SVGs for visual clarity)
// ---------------------------------------------------------------------------

const SHAPE_OPTIONS = [
  { value: 'circle' as const, label: 'Circle', icon: 'fa-circle' },
  { value: 'rounded' as const, label: 'Rounded', icon: 'fa-square' },
  { value: 'square' as const, label: 'Square', icon: 'fa-square-full' },
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

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      {/* Faded token icon silhouette */}
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-surface-2">
        <i className="fas fa-coins text-3xl text-white/10" />
      </div>
      <p className="text-center text-sm text-white/30">
        Select a token to start configuring
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preview area
// ---------------------------------------------------------------------------

interface PreviewAreaProps {
  imageUrl: string
  networkUrl: string
  networkName: string
}

function PreviewArea({ imageUrl, networkUrl, networkName }: PreviewAreaProps) {
  const { selectedToken, appearance, badge } = useStudio()

  const { width, height, shape, borderRadius, shadow, backgroundColor } = appearance

  const borderRadiusCSS = shapeToRadius(shape, borderRadius)
  const boxShadow = SHADOW_MAP[shadow] ?? 'none'

  const badgePosition = useMemo(() => {
    if (!badge.enabled) return null
    return badgePositionToCSS(width, badge.angleDeg, badge.sizeRatio, badge.overlap)
  }, [badge.enabled, badge.angleDeg, badge.sizeRatio, badge.overlap, width])

  const tokenName = selectedToken?.name ?? 'Token'
  const tokenSymbol = selectedToken?.symbol ?? ''
  const tokenAddress = selectedToken?.address ?? ''

  return (
    <div className="flex flex-col gap-4">
      {/* Main preview */}
      <div className="elevated-card flex flex-col items-center gap-3 p-6">
        <SectionHeading>Preview</SectionHeading>

        <div
          className="relative inline-flex items-center justify-center"
          style={{
            width,
            height,
          }}
        >
          {/* Token image */}
          <img
            src={imageUrl}
            alt={tokenName}
            style={{
              width,
              height,
              borderRadius: borderRadiusCSS,
              boxShadow: boxShadow !== 'none' ? boxShadow : undefined,
              backgroundColor: backgroundColor !== 'transparent' ? backgroundColor : undefined,
            }}
          />

          {/* Badge */}
          {badge.enabled && badgePosition && (
            <img
              src={networkUrl}
              alt={networkName}
              style={{
                position: 'absolute',
                top: Math.round(badgePosition.top),
                left: Math.round(badgePosition.left),
                width: Math.round(badgePosition.badgeSize),
                height: Math.round(badgePosition.badgeSize),
                borderRadius: '50%',
                ...(badge.ringEnabled
                  ? { border: `${badge.ringThickness}px solid ${badge.ringColor}` }
                  : {}),
              }}
            />
          )}
        </div>
      </div>

      {/* Mini context previews */}
      <div className="grid grid-cols-3 gap-2">
        {/* Avatar preview */}
        <div className="elevated-card flex flex-col items-center gap-2 p-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-white/30">
            Avatar
          </span>
          <img
            src={imageUrl}
            alt={tokenName}
            className="rounded-full"
            style={{ width: 32, height: 32 }}
          />
        </div>

        {/* Card preview */}
        <div className="elevated-card flex flex-col items-center gap-2 p-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-white/30">
            Card
          </span>
          <div className="flex flex-col items-center gap-1">
            <img
              src={imageUrl}
              alt={tokenName}
              className="rounded-lg"
              style={{ width: 24, height: 24 }}
            />
            <span className="max-w-full truncate text-[10px] font-medium text-white/70">
              {tokenName}
            </span>
          </div>
        </div>

        {/* List item preview */}
        <div className="elevated-card flex flex-col items-center gap-2 p-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-white/30">
            List
          </span>
          <div className="flex w-full items-center gap-1.5 overflow-hidden">
            <img
              src={imageUrl}
              alt={tokenName}
              className="shrink-0 rounded-full"
              style={{ width: 16, height: 16 }}
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[9px] font-medium text-white/70">
                {tokenSymbol}
              </span>
              <span className="truncate text-[8px] font-mono text-white/30">
                {tokenAddress.slice(0, 6)}...
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Appearance controls
// ---------------------------------------------------------------------------

function AppearanceControls() {
  const { appearance, updateAppearance } = useStudio()
  const [aspectLinked, setAspectLinked] = useState(true)

  const handleWidthChange = useCallback(
    (value: number) => {
      if (aspectLinked) {
        updateAppearance({ width: value, height: value })
        return
      }
      updateAppearance({ width: value })
    },
    [aspectLinked, updateAppearance],
  )

  const handleHeightChange = useCallback(
    (value: number) => {
      if (aspectLinked) {
        updateAppearance({ width: value, height: value })
        return
      }
      updateAppearance({ height: value })
    },
    [aspectLinked, updateAppearance],
  )

  const handleShapeChange = useCallback(
    (shape: 'circle' | 'rounded' | 'square') => {
      updateAppearance({ shape })
    },
    [updateAppearance],
  )

  const handleShadowChange = useCallback(
    (shadow: 'none' | 'subtle' | 'medium' | 'strong') => {
      updateAppearance({ shadow })
    },
    [updateAppearance],
  )

  const handleBorderRadiusChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updateAppearance({ borderRadius: Number(event.target.value) })
    },
    [updateAppearance],
  )

  const handleBackgroundChange = useCallback(
    (color: string) => {
      updateAppearance({ backgroundColor: color })
    },
    [updateAppearance],
  )

  const handleCustomColorChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updateAppearance({ backgroundColor: event.target.value })
    },
    [updateAppearance],
  )

  const isCustomBackground = !BACKGROUND_SWATCHES.some(
    (s) => s.value === appearance.backgroundColor,
  )

  return (
    <div className="elevated-card flex flex-col gap-4 p-4">
      <SectionHeading>Appearance</SectionHeading>

      {/* Size */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-white/60">Size</label>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1">
            <span className="text-[10px] text-white/30">W</span>
            <input
              type="number"
              min={16}
              max={512}
              value={appearance.width}
              onChange={(e) => handleWidthChange(Number(e.target.value))}
              className="w-full rounded-lg border border-border-dark bg-surface-2 px-2 py-1.5 text-center text-sm text-white/80 focus:border-accent-500 focus:outline-none"
            />
          </div>

          {/* Link/unlink toggle */}
          <button
            type="button"
            onClick={() => setAspectLinked((v) => !v)}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
              aspectLinked
                ? 'bg-accent-500/15 text-accent-500'
                : 'bg-surface-2 text-white/30 hover:text-white/50'
            }`}
            aria-label={aspectLinked ? 'Unlink aspect ratio' : 'Link aspect ratio'}
          >
            <i className={`fas ${aspectLinked ? 'fa-link' : 'fa-link-slash'} text-xs`} />
          </button>

          <div className="flex flex-1 items-center gap-1">
            <span className="text-[10px] text-white/30">H</span>
            <input
              type="number"
              min={16}
              max={512}
              value={appearance.height}
              onChange={(e) => handleHeightChange(Number(e.target.value))}
              className="w-full rounded-lg border border-border-dark bg-surface-2 px-2 py-1.5 text-center text-sm text-white/80 focus:border-accent-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Shape */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-white/60">Shape</label>
        <div className="flex gap-2">
          {SHAPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleShapeChange(option.value)}
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition-all ${
                appearance.shape === option.value
                  ? 'border-accent-500 bg-accent-500/10 text-accent-500'
                  : 'border-border-dark bg-surface-2 text-white/50 hover:text-white/70'
              }`}
            >
              <i className={`fas ${option.icon} text-sm`} />
              {option.label}
            </button>
          ))}
        </div>

        {/* Border radius slider (only for rounded) */}
        {appearance.shape === 'rounded' && (
          <div className="flex items-center gap-3">
            <label htmlFor="border-radius" className="shrink-0 text-xs text-white/40">
              Radius
            </label>
            <input
              id="border-radius"
              type="range"
              min={0}
              max={Math.min(appearance.width, appearance.height) / 2}
              step={1}
              value={appearance.borderRadius}
              onChange={handleBorderRadiusChange}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent-500"
            />
            <span className="min-w-[3ch] text-right font-mono text-xs text-accent-500">
              {appearance.borderRadius}px
            </span>
          </div>
        )}
      </div>

      {/* Shadow */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-white/60">Shadow</label>
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
          {SHADOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleShadowChange(option.value)}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all ${
                appearance.shadow === option.value
                  ? 'bg-surface-3 text-white shadow-sm'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Background */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-white/60">Background</label>
        <div className="flex items-center gap-2">
          {BACKGROUND_SWATCHES.map((swatch) => (
            <button
              key={swatch.value}
              type="button"
              onClick={() => handleBackgroundChange(swatch.value)}
              aria-label={swatch.label}
              className={`relative h-8 w-8 shrink-0 rounded-lg border-2 transition-all ${
                appearance.backgroundColor === swatch.value
                  ? 'border-accent-500 ring-2 ring-accent-500/30'
                  : 'border-border-dark hover:border-white/30'
              }`}
              style={
                swatch.value === 'transparent'
                  ? {
                      backgroundImage:
                        'linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)',
                      backgroundSize: '8px 8px',
                      backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                    }
                  : { backgroundColor: swatch.value }
              }
            />
          ))}

          {/* Custom color picker */}
          <div className="relative">
            <input
              type="color"
              value={isCustomBackground ? appearance.backgroundColor : '#666666'}
              onChange={handleCustomColorChange}
              className="h-8 w-8 cursor-pointer rounded-lg border-2 border-border-dark bg-surface-3 p-0.5"
              aria-label="Custom background color"
            />
          </div>

          {/* Display current color */}
          {isCustomBackground && (
            <span className="font-mono text-xs text-white/40">
              {appearance.backgroundColor}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SVG options
// ---------------------------------------------------------------------------

interface SvgOptionsProps {
  imageUrl: string
}

function SvgOptions({ imageUrl }: SvgOptionsProps) {
  const { metadata, isLoading } = useImageMetadata(imageUrl)

  // Only show for SVG images
  if (isLoading || !metadata || metadata.format !== 'SVG') return null

  return (
    <div className="elevated-card flex flex-col gap-3 p-4">
      <SectionHeading>SVG Options</SectionHeading>

      <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 text-xs text-blue-400">
        <i className="fas fa-info-circle mt-0.5 shrink-0" />
        <span>
          This image is in SVG format. SVG images can be rendered as an <code className="rounded bg-surface-3 px-1">&lt;img&gt;</code> tag
          or inlined for color customization.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-white/60">
          Render mode
        </label>
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
          <button
            type="button"
            className="flex-1 rounded-md bg-surface-3 px-3 py-1.5 text-xs font-medium text-white shadow-sm"
          >
            &lt;img src&gt;
          </button>
          <button
            type="button"
            className="flex-1 rounded-md px-3 py-1.5 text-xs font-medium text-white/40 hover:text-white/70"
            disabled
            title="Inline SVG mode — coming soon"
          >
            Inline SVG
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * StudioConfigurator — the right panel of the Studio page, assembling all
 * configurator sub-components: preview, appearance controls, badge config,
 * SVG options, list resolution order, and code output.
 *
 * Reads/writes all state via `useStudio()` context.
 */
export default function StudioConfigurator() {
  const { selectedToken, selectedChainId, resolutionOrder } = useStudio()

  const hasToken = selectedToken !== null

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

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-6 p-4">
        {/* Empty state */}
        {!hasToken && (
          <>
            <EmptyState />
            <div className="pointer-events-none opacity-40">
              <AppearanceControls />
            </div>
          </>
        )}

        {/* Active configurator */}
        {hasToken && (
          <>
            {/* 1. Preview area */}
            <PreviewArea
              imageUrl={imageUrl}
              networkUrl={networkUrl}
              networkName={networkName}
            />

            {/* 2. Appearance controls */}
            <AppearanceControls />

            {/* 3. Badge section */}
            <BadgeConfigurator />

            {/* 4. SVG options (conditional) */}
            <SvgOptions imageUrl={imageUrl} />

            {/* 5. List resolution order */}
            <ListResolutionOrder />

            {/* 6. Code output */}
            <div className="elevated-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <i className="fas fa-code text-xs text-accent-500" />
                <span className="font-heading text-sm font-semibold text-white/90">
                  Code Output
                </span>
              </div>
              <CodeOutput />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
