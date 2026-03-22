import { useCallback } from 'react'
import { useStudio } from '../contexts/StudioContext'
import RadialPositionPicker from './RadialPositionPicker'

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function overlapLabel(overlap: number): string {
  if (overlap <= -0.4) return 'Float'
  if (overlap >= 0.4) return 'Inset'
  return 'Edge'
}

function CompactSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  displayValue: string
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-gray-500 dark:text-white/50">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-accent-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-surface-3"
      />
      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-accent-500">{displayValue}</span>
    </div>
  )
}

export default function BadgeConfigurator() {
  const { badge, updateBadge } = useStudio()

  const handleAngleChange = useCallback(
    (angleDeg: number) => updateBadge({ angleDeg }),
    [updateBadge],
  )

  const isDisabled = !badge.enabled

  return (
    <div className={`flex flex-col gap-3 transition-opacity ${isDisabled ? 'pointer-events-none opacity-40' : ''}`}>
      {/* Position — radial picker inline */}
      <div className="flex items-center gap-3">
        <RadialPositionPicker angleDeg={badge.angleDeg} onChange={handleAngleChange} />
        <div className="flex flex-1 flex-col gap-2">
          <CompactSlider
            label="Size"
            value={badge.sizeRatio}
            min={0.15}
            max={0.6}
            step={0.01}
            displayValue={formatPercent(badge.sizeRatio)}
            disabled={isDisabled}
            onChange={(sizeRatio) => updateBadge({ sizeRatio })}
          />
          <CompactSlider
            label={overlapLabel(badge.overlap)}
            value={badge.overlap}
            min={-0.5}
            max={0.5}
            step={0.01}
            displayValue={formatPercent(badge.overlap)}
            disabled={isDisabled}
            onChange={(overlap) => updateBadge({ overlap })}
          />
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border-light dark:bg-border-dark" />

      {/* Shape + Ring — compact row */}
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-[11px] text-gray-500 dark:text-white/50">Shape</span>
        <div className="flex gap-1">
          {(['circle', 'square'] as const).map((shape) => (
            <button
              key={shape}
              type="button"
              onClick={() => updateBadge({ badgeShape: shape })}
              disabled={isDisabled}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                (badge.badgeShape ?? 'circle') === shape
                  ? 'bg-accent-500/10 text-accent-500'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-surface-3 dark:text-white/50'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {shape.charAt(0).toUpperCase() + shape.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Padding + Background — compact row */}
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-[11px] text-gray-500 dark:text-white/50">Pad / BG</span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={4}
            step={1}
            value={badge.badgePadding ?? 0}
            disabled={isDisabled}
            onChange={(e) => updateBadge({ badgePadding: Number(e.target.value) })}
            className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-gray-200 accent-accent-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-surface-3"
          />
          <span className="w-6 text-right font-mono text-[10px] text-accent-500">{badge.badgePadding ?? 0}</span>
          <button
            type="button"
            onClick={() => updateBadge({ badgeBackground: 'transparent' })}
            disabled={isDisabled}
            aria-label="Transparent"
            className={`h-6 w-6 shrink-0 rounded-md border-2 transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
              (badge.badgeBackground ?? 'transparent') === 'transparent'
                ? 'border-accent-500 ring-1 ring-accent-500/30'
                : 'border-border-light dark:border-border-dark'
            }`}
            style={{
              backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
              backgroundSize: '5px 5px',
              backgroundPosition: '0 0, 0 2.5px, 2.5px -2.5px, -2.5px 0px',
            }}
          />
          <input
            type="color"
            value={(badge.badgeBackground ?? 'transparent') !== 'transparent' ? badge.badgeBackground! : '#666666'}
            disabled={isDisabled}
            onChange={(e) => updateBadge({ badgeBackground: e.target.value })}
            className="h-6 w-6 cursor-pointer rounded-md border border-border-light bg-gray-50 p-0.5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-border-dark dark:bg-surface-3"
            aria-label="Badge background color"
          />
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border-light dark:bg-border-dark" />

      {/* Ring — compact */}
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-[11px] text-gray-500 dark:text-white/50">Ring</span>
        <label className="flex cursor-pointer items-center gap-2">
          <div className="relative flex">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={badge.ringEnabled}
              disabled={isDisabled}
              onChange={(e) => updateBadge({ ringEnabled: e.target.checked })}
            />
            <div className="h-4 w-7 rounded-full bg-gray-200 transition-colors peer-checked:bg-accent-500/20 dark:bg-surface-3" />
            <div className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-gray-400 transition-all peer-checked:translate-x-3 peer-checked:bg-accent-500 dark:bg-white/40" />
          </div>
        </label>
        {badge.ringEnabled && (
          <>
            <input
              type="color"
              value={badge.ringColor}
              disabled={isDisabled}
              onChange={(e) => updateBadge({ ringColor: e.target.value })}
              className="h-6 w-6 cursor-pointer rounded-md border border-border-light bg-gray-50 p-0.5 dark:border-border-dark dark:bg-surface-3"
              aria-label="Ring color"
            />
            <input
              type="range"
              min={1}
              max={6}
              step={1}
              value={badge.ringThickness}
              disabled={isDisabled}
              onChange={(e) => updateBadge({ ringThickness: Number(e.target.value) })}
              className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-gray-200 accent-accent-500 dark:bg-surface-3"
            />
            <span className="font-mono text-[10px] text-accent-500">{badge.ringThickness}px</span>
          </>
        )}
      </div>
    </div>
  )
}
