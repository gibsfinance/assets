import { useEffect, useRef, useState } from 'react'

interface CountUpNumberProps {
  end: number
  duration?: number
  className?: string
}

export default function CountUpNumber({ end, duration = 2000, className }: CountUpNumberProps) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const hasTriggered = useRef(false)
  // The number currently on screen, so a run that starts after an earlier one can pick up
  // from it instead of reading a stale closure.
  const displayed = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let frame: number | null = null
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame)
    }

    const run = () => {
      const from = displayed.current
      const start = performance.now()
      const animate = (now: number) => {
        const elapsed = now - start
        const progress = Math.min(elapsed / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        const next = Math.round(from + (end - from) * eased)
        displayed.current = next
        setCount(next)
        if (progress < 1) frame = requestAnimationFrame(animate)
      }
      frame = requestAnimationFrame(animate)
    }

    // A target that changes after the counter has already run has to be animated to.
    // Previously the trigger flag blocked every later run, and the in-flight animation
    // held a closure over the old target, so the number settled on whatever the first
    // value had been and stayed there — on the landing page, a figure that has quietly
    // stopped tracking the metric it reports while still looking live.
    if (hasTriggered.current) {
      run()
      return cancel
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasTriggered.current) {
          hasTriggered.current = true
          run()
          observer.disconnect()
        }
      },
      { threshold: 0 },
    )

    observer.observe(el)
    return () => {
      observer.disconnect()
      cancel()
    }
  }, [end, duration])

  return (
    <span ref={ref} className={className}>
      {count.toLocaleString()}
    </span>
  )
}
