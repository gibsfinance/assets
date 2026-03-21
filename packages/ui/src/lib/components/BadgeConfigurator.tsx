import { useCallback } from 'react'
import { useStudio } from '../contexts/StudioContext'
import RadialPositionPicker from './RadialPositionPicker'

/** Formats a ratio (0-1) as a percentage string, e.g. 0.3 -> "30%" */
function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** Returns the overlap label based on the overlap value. */
function overlapLabel(overlap: number): string {
  if (overlap <= -0.4) return 'Float'
  if (overlap >= 0.4) return 'Inset'
  return 'Edge'
}

interface LabeledSliderProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  displayValue: string
  disabled: boolean
  onChange: (value: number) => void
}

function LabeledSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  displayValue,
  disabled,
  onChange,
}: LabeledSliderProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className="text-xs font-medium text-gray-500 dark:text-white/60"
        >
          {label}
        </label>
        <span className="text-xs font-mono text-accent-500">{displayValue}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-accent-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-surface-3"
      />
    </div>
  )
}

interface ToggleSwitchProps {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

function ToggleSwitch({ id, label, checked, onChange, disabled = false }: ToggleSwitchProps) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-center gap-3 ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <div className="relative flex">
        <input
          id={id}
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="h-6 w-11 rounded-full bg-gray-200 transition-colors peer-checked:bg-accent-500/20 dark:bg-surface-3" />
        <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-gray-400 transition-all peer-checked:translate-x-5 peer-checked:bg-accent-500 dark:bg-white/40" />
      </div>
      {label && (
        <span className="text-sm font-medium text-gray-600 dark:text-white/70">{label}</span>
      )}
    </label>
  )
}

/**
 * BadgeConfigurator — controls for badge position, size, overlap, and ring.
 * Reads and writes via useStudio().badge / useStudio().updateBadge.
 */
export default function BadgeConfigurator() {
  const { badge, updateBadge } = useStudio()

  const handleAngleChange = useCallback(
    (angleDeg: number) => updateBadge({ angleDeg }),
    [updateBadge],
  )

  const handleSizeChange = useCallback(
    (sizeRatio: number) => updateBadge({ sizeRatio }),
    [updateBadge],
  )

  const handleOverlapChange = useCallback(
    (overlap: number) => updateBadge({ overlap }),
    [updateBadge],
  )

  const handleRingColorChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => updateBadge({ ringColor: event.target.value }),
    [updateBadge],
  )

  const handleRingThicknessChange = useCallback(
    (ringThickness: number) => updateBadge({ ringThickness }),
    [updateBadge],
  )

  const isDisabled = !badge.enabled

  return (
    <div className={`flex flex-col gap-4 transition-opacity ${isDisabled ? 'pointer-events-none opacity-40' : ''}`}>

        {/* Position */}
        <div className="rounded-lg border border-border-light bg-white p-4 dark:border-border-dark dark:bg-surface-1">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-white/40">
            Position
          </p>
          <RadialPositionPicker angleDeg={badge.angleDeg} onChange={handleAngleChange} />
        </div>

        {/* Size + Overlap */}
        <div className="rounded-lg border border-border-light bg-white p-4 dark:border-border-dark dark:bg-surface-1">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-white/40">
            Scale
          </p>
          <div className="flex flex-col gap-4">
            <LabeledSlider
              id="badge-size"
              label="Size"
              value={badge.sizeRatio}
              min={0.15}
              max={0.6}
              step={0.01}
              displayValue={formatPercent(badge.sizeRatio)}
              disabled={isDisabled}
              onChange={handleSizeChange}
            />

            <LabeledSlider
              id="badge-overlap"
              label={`Overlap — ${overlapLabel(badge.overlap)}`}
              value={badge.overlap}
              min={-0.5}
              max={0.5}
              step={0.01}
              displayValue={formatPercent(badge.overlap)}
              disabled={isDisabled}
              onChange={handleOverlapChange}
            />

            {/* Overlap landmark labels */}
            <div className="flex justify-between text-[10px] text-gray-400 dark:text-white/30">
              <span>Float</span>
              <span>Edge</span>
              <span>Inset</span>
            </div>
          </div>
        </div>

        {/* Ring controls */}
        <div className="rounded-lg border border-border-light bg-white p-4 dark:border-border-dark dark:bg-surface-1">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-white/40">
              Ring
            </p>
            <ToggleSwitch
              id="badge-ring-enabled"
              label="Enable ring"
              checked={badge.ringEnabled}
              onChange={(ringEnabled) => updateBadge({ ringEnabled })}
              disabled={isDisabled}
            />
          </div>

          {badge.ringEnabled && (
            <div className="mt-3 flex flex-col gap-4">
              {/* Ring color */}
              <div className="flex items-center gap-3">
                <label
                  htmlFor="badge-ring-color"
                  className="min-w-0 flex-1 text-xs font-medium text-gray-500 dark:text-white/60"
                >
                  Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="badge-ring-color"
                    type="color"
                    value={badge.ringColor}
                    disabled={isDisabled}
                    onChange={handleRingColorChange}
                    className="h-8 w-12 cursor-pointer rounded-md border border-border-light bg-gray-50 p-0.5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-border-dark dark:bg-surface-3"
                  />
                  <span className="font-mono text-xs text-gray-500 dark:text-white/50">{badge.ringColor}</span>
                </div>
              </div>

              {/* Ring thickness */}
              <LabeledSlider
                id="badge-ring-thickness"
                label="Thickness"
                value={badge.ringThickness}
                min={1}
                max={6}
                step={1}
                displayValue={`${badge.ringThickness}px`}
                disabled={isDisabled}
                onChange={handleRingThicknessChange}
              />
            </div>
          )}
        </div>
      </div>
  )
}
