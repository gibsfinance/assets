import { useEffect, useState, type RefObject } from 'react'

/** How far outside the viewport an element counts as near, in pixels. */
export const NEAR_VIEW_MARGIN = '200px'

/**
 * Report whether an element has come within `NEAR_VIEW_MARGIN` of the viewport.
 * The answer latches: once true it stays true and the observer is released.
 * Where `IntersectionObserver` does not exist, the element counts as near so
 * that deferred work still happens.
 *
 * @param target - Ref to the element to watch.
 * @returns `true` once the element has been near the viewport.
 */
export function useNearView(target: RefObject<Element | null>): boolean {
  const [isNear, setIsNear] = useState(false)

  useEffect(() => {
    if (isNear) return
    const element = target.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setIsNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setIsNear(true)
        observer.disconnect()
      },
      { rootMargin: NEAR_VIEW_MARGIN },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [isNear, target])

  return isNear
}
