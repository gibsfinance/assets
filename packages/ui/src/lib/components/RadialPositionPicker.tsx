import { useRef, useCallback, useState } from 'react'

interface RadialPositionPickerProps {
  angleDeg: number
  onChange: (angleDeg: number) => void
}

const CIRCLE_SIZE = 120
const HANDLE_SIZE = 12
const CENTER = CIRCLE_SIZE / 2
const RADIUS = (CIRCLE_SIZE - HANDLE_SIZE - 4) / 2

/**
 * Calculates the angle in degrees (0–360) from a pointer event relative to
 * the circle center. 0° = top center, 90° = right, 180° = bottom, 270° = left.
 */
function angleFromPointer(clientX: number, clientY: number, rect: DOMRect): number {
  const dx = clientX - (rect.left + CENTER)
  const dy = clientY - (rect.top + CENTER)
  // atan2 gives 0° at right; offset by -90° so 0° maps to top
  const rawDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90
  return ((rawDeg % 360) + 360) % 360
}

/**
 * Converts an angle in degrees to x/y coordinates on the circle circumference.
 * 0° = top center.
 */
function handlePosition(angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: CENTER + RADIUS * Math.cos(rad),
    y: CENTER + RADIUS * Math.sin(rad),
  }
}

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
      const value = Number(event.target.value)
      if (!Number.isNaN(value)) {
        onChange(((value % 360) + 360) % 360)
      }
    },
    [onChange],
  )

  const { x, y } = handlePosition(angleDeg)

  return (
    <div className="flex items-center gap-3">
      {/* Circle track */}
      <div
        ref={circleRef}
        className="relative flex-shrink-0 cursor-crosshair rounded-full border border-border-dark bg-surface-2 select-none"
        style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}
        onPointerDown={handlePointerDown}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={angleDeg}
        aria-label="Badge angle"
        tabIndex={0}
      >
        {/* Center dot */}
        <div
          className="absolute rounded-full bg-white/10"
          style={{
            width: 4,
            height: 4,
            left: CENTER - 2,
            top: CENTER - 2,
          }}
        />

        {/* Radius line */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={CIRCLE_SIZE}
          height={CIRCLE_SIZE}
        >
          <line
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={1}
          />
        </svg>

        {/* Draggable handle */}
        <div
          className="absolute rounded-full bg-accent-500 shadow-glow-green transition-transform duration-75"
          style={{
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            left: x - HANDLE_SIZE / 2,
            top: y - HANDLE_SIZE / 2,
            transform: active ? 'scale(1.3)' : 'scale(1)',
          }}
        />
      </div>

      {/* Degree input */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium uppercase tracking-wide text-white/40">
          Angle
        </label>
        <input
          type="number"
          min={0}
          max={359}
          value={Math.round(angleDeg)}
          onChange={handleInputChange}
          className="w-16 rounded-md border border-border-dark bg-surface-3 px-2 py-1 text-center text-sm text-white/90 focus:border-accent-500/60 focus:outline-none focus:ring-1 focus:ring-accent-500/30"
          aria-label="Angle in degrees"
        />
        <span className="text-[10px] text-white/30">degrees</span>
      </div>
    </div>
  )
}
