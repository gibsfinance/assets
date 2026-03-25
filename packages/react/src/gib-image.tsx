import { useState, useEffect, useRef, type CSSProperties } from 'react'

export interface GibImageProps {
  src: string
  /** Display width in CSS pixels */
  width?: number
  /** Display height in CSS pixels */
  height?: number
  /** Shorthand for both width and height */
  size?: number
  alt?: string
  /** Show a placeholder skeleton while loading */
  skeleton?: boolean
  /** Lazy load via IntersectionObserver */
  lazy?: boolean
  /** IntersectionObserver rootMargin (default: '200px') */
  lazyMargin?: string
  /** Shape of the skeleton placeholder */
  shape?: 'circle' | 'rect'
  /** Additional className for the img element */
  className?: string
  /** Additional style for the img element */
  style?: CSSProperties
  /** Called when image fails to load */
  onError?: () => void
  /** Called when image loads successfully */
  onLoad?: () => void
}

/** Set up an IntersectionObserver for lazy loading. Returns a cleanup function or undefined. */
export function setupLazyObserver(
  el: HTMLElement | null,
  onVisible: () => void,
  margin: string,
): (() => void) | undefined {
  if (!el) return undefined
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        onVisible()
        observer.disconnect()
      }
    },
    { rootMargin: margin },
  )
  observer.observe(el)
  return () => observer.disconnect()
}

/**
 * Low-level image component with skeleton loading and IntersectionObserver.
 * Used internally by TokenImage and NetworkImage.
 *
 * @example
 * ```tsx
 * <GibImage
 *   src="https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?w=64&h=64&format=webp"
 *   size={32}
 *   skeleton
 *   lazy
 *   shape="circle"
 * />
 * ```
 */
export default function GibImage({
  src,
  width,
  height,
  size = 32,
  alt = '',
  skeleton = true,
  lazy = true,
  lazyMargin = '200px',
  shape = 'circle',
  className,
  style,
  onError,
  onLoad,
}: GibImageProps) {
  const w = width || size
  const h = height || size
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(!lazy)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!lazy) return
    return setupLazyObserver(ref.current, () => setVisible(true), lazyMargin)
  }, [lazy, lazyMargin])

  const borderRadius = shape === 'circle' ? '50%' : '4px'

  const containerStyle: CSSProperties = {
    display: 'inline-block',
    position: 'relative',
    width: w,
    height: h,
    flexShrink: 0,
  }

  const skeletonStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius,
    backgroundColor: '#e5e7eb',
    ...(loaded || failed ? { display: 'none' } : {}),
  }

  const imgStyle: CSSProperties = {
    width: w,
    height: h,
    borderRadius,
    opacity: loaded ? 1 : 0,
    ...style,
  }

  return (
    <span ref={ref} style={containerStyle}>
      {skeleton && <span style={skeletonStyle} />}
      {visible && !failed && (
        <img
          src={src}
          alt={alt}
          width={w}
          height={h}
          draggable={false}
          decoding="async"
          className={className}
          style={imgStyle}
          onLoad={() => {
            setLoaded(true)
            onLoad?.()
          }}
          onError={() => {
            setFailed(true)
            onError?.()
          }}
        />
      )}
    </span>
  )
}
