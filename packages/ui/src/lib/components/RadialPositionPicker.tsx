import { useRef, useCallback, useState } from 'react'
import {
  CIRCLE_SIZE,
  HANDLE_SIZE,
  CENTER,
  angleFromPointer,
  handlePosition,
  normalizeAngle,
} from '../utils/radial-angle'

export interface RadialPositionPickerProps {
  angleDeg: number
  onChange: (angleDeg: number) => void
}

/** Preset angle snap positions */
const SNAP_PRESETS = [
  { label: 'TL', angleDeg: 315 },
  { label: 'TR', angleDeg: 45 },
  { label: 'BL', angleDeg: 225 },
  { label: 'BR', angleDeg: 135 },
] as const

/**
 * A circular drag control for selecting an angle (0–360°).
 * 0° = top center, 90° = right, 180° = bottom, 270° = left.
 */
export default function RadialPositionPicker({ angleDeg, onChange }: RadialPositionPickerProps) {
  const circleRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const [active, setActive] = useState(false)

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!isDragging.current || !circleRef.current) return
      const rect = circleRef.current.getBoundingClientRect()
      onChange(Math.round(angleFromPointer(event.clientX, event.clientY, rect)))
    },
    [onChange],
  )

  const handlePointerUp = useCallback(() => {
    if (!isDragging.current) return
    isDragging.current = false
    setActive(false)
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
  }, [handlePointerMove])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      isDragging.current = true
      setActive(true)
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [handlePointerMove, handlePointerUp],
  )

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      // Not guarded against a value that is not a number. A number input only ever
      // reports a numeric string or an empty one, and `Number('')` is 0 rather than
      // NaN, so there is no reading of this field that produces one.
      onChange(normalizeAngle(Number(event.target.value)))
    },
    [onChange],
  )

  const { x, y } = handlePosition(angleDeg)

  return (
    <div className="flex items-center gap-3">
      {/* Circle track with snap buttons */}
      <div className="relative flex-shrink-0" style={{ width: CIRCLE_SIZE + 32, height: CIRCLE_SIZE + 32 }}>
        {/* Snap-to-corner buttons */}
        {SNAP_PRESETS.map((preset) => {
          const isActive = Math.round(angleDeg) === preset.angleDeg
          const positionClasses =
            preset.label === 'TL'
              ? 'top-0 left-0'
              : preset.label === 'TR'
                ? 'top-0 right-0'
                : preset.label === 'BL'
                  ? 'bottom-0 left-0'
                  : 'bottom-0 right-0'
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.angleDeg)}
              className={`absolute z-10 rounded px-1 py-0.5 text-[9px] font-semibold leading-none transition-colors ${positionClasses} ${
                isActive
                  ? 'bg-accent/20 text-accent-content'
                  : 'bg-surface-active/80 text-content-subtle hover:bg-surface-active'
              }`}
              aria-label={`Snap to ${preset.label} (${preset.angleDeg}°)`}>
              {preset.label}
            </button>
          )
        })}

        {/* Circle track */}
        <div
          ref={circleRef}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border border-border bg-surface-inset select-none"
          style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}
          onPointerDown={handlePointerDown}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={angleDeg}
          aria-label="Badge angle"
          tabIndex={0}>
          {/* Center dot */}
          <div
            className="absolute rounded-full bg-surface-wash-active"
            style={{
              width: 4,
              height: 4,
              left: CENTER - 2,
              top: CENTER - 2,
            }}
          />

          {/* Radius line */}
          <svg className="pointer-events-none absolute inset-0" width={CIRCLE_SIZE} height={CIRCLE_SIZE}>
            <line x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
          </svg>

          {/* Draggable handle */}
          <div
            className="absolute rounded-full bg-accent shadow-glow-accent transition-transform duration-75"
            style={{
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              left: x - HANDLE_SIZE / 2,
              top: y - HANDLE_SIZE / 2,
              transform: active ? 'scale(1.3)' : 'scale(1)',
            }}
          />
        </div>
      </div>

      {/* Degree input */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-wide text-content-faint">Angle</label>
        <input
          type="number"
          min={0}
          max={359}
          value={Math.round(angleDeg)}
          onChange={handleInputChange}
          className="w-16 rounded-md border border-border bg-surface-control px-2 py-1 text-center text-sm text-content-body focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/30"
          aria-label="Angle in degrees"
        />
        <span className="text-[10px] text-content-faint">degrees</span>
      </div>
    </div>
  )
}
