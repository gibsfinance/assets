import { useCallback, useRef } from 'react'

interface NumberStepperProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Label shown to the left */
  label?: string
  /** Width class for the container (default: 'w-[72px]') */
  width?: string
}

/**
 * Compact number input with custom -/+ stepper buttons.
 * Replaces native number inputs to avoid browser-default spinner arrows.
 * Supports click-and-hold for rapid increment/decrement.
 */
export default function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
  label,
  width = 'w-[72px]',
}: NumberStepperProps) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clamp = useCallback(
    (v: number) => Math.min(max, Math.max(min, v)),
    [min, max],
  )

  const increment = useCallback(() => {
    onChange(clamp(value + step))
  }, [onChange, clamp, value, step])

  const decrement = useCallback(() => {
    onChange(clamp(value - step))
  }, [onChange, clamp, value, step])

  const startHold = useCallback(
    (action: () => void) => {
      // Initial delay before rapid fire
      timeoutRef.current = setTimeout(() => {
        intervalRef.current = setInterval(action, 80)
      }, 400)
    },
    [],
  )

  const stopHold = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (intervalRef.current) clearInterval(intervalRef.current)
    timeoutRef.current = null
    intervalRef.current = null
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      if (raw === '') return
      onChange(clamp(Number(raw)))
    },
    [onChange, clamp],
  )

  const btnClass =
    'flex h-full w-5 items-center justify-center text-[9px] text-gray-400 dark:text-white/30 hover:text-accent-500 hover:bg-accent-500/10 transition-colors select-none'

  return (
    <div className="flex items-center gap-1">
      {label && (
        <span className="text-[10px] font-medium text-gray-400 dark:text-white/40">
          {label}
        </span>
      )}
      <div
        className={`${width} flex h-7 items-stretch rounded-md border border-border-light bg-gray-50 dark:border-border-dark dark:bg-surface-2 overflow-hidden`}
      >
        <button
          type="button"
          onClick={decrement}
          onMouseDown={() => startHold(decrement)}
          onMouseUp={stopHold}
          onMouseLeave={stopHold}
          className={btnClass}
          aria-label="Decrease"
          disabled={value <= min}
        >
          <i className="fas fa-minus" />
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={handleInputChange}
          className="flex-1 min-w-0 bg-transparent text-center text-xs font-medium text-gray-700 dark:text-white/80 focus:outline-none [appearance:textfield]"
        />
        <button
          type="button"
          onClick={increment}
          onMouseDown={() => startHold(increment)}
          onMouseUp={stopHold}
          onMouseLeave={stopHold}
          className={btnClass}
          aria-label="Increase"
          disabled={value >= max}
        >
          <i className="fas fa-plus" />
        </button>
      </div>
    </div>
  )
}
