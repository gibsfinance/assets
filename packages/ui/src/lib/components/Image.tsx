import { useState, useMemo, useEffect, useRef, type ReactNode, type CSSProperties } from 'react'

interface FallbackProps {
  height?: number
  width?: number
  className?: string
  style?: CSSProperties
  src?: string
  alt?: string
}

interface ImageProps {
  size?: number
  height?: number
  width?: number
  className?: string
  style?: CSSProperties
  src: string
  alt?: string
  /** Called when the image fails to load */
  onError?: () => void
  /** Called when the image successfully loads */
  onLoad?: () => void
  /** Render a custom fallback on error */
  fallback?: (props: FallbackProps) => ReactNode
  fallbackProps?: FallbackProps
  /** Show a skeleton placeholder until loaded (default: false) */
  skeleton?: boolean
  /** Custom skeleton className (default: rounded gray circle) */
  skeletonClassName?: string
  /** Lazy load via IntersectionObserver (default: false) */
  lazy?: boolean
  /** IntersectionObserver rootMargin for lazy loading (default: '200px') */
  lazyMargin?: string
  /** Shape of the skeleton: 'circle' or 'rect' (default: 'circle') */
  shape?: 'circle' | 'rect'
  /** Make the image a link */
  href?: string
}

export default function Image({
  size = 48,
  height,
  width,
  className,
  src,
  alt,
  style,
  fallbackProps,
  fallback,
  onError,
  onLoad,
  skeleton = false,
  skeletonClassName,
  lazy = false,
  lazyMargin = '200px',
  shape = 'circle',
  href,
}: ImageProps) {
  const [shouldFallback, setShouldFallback] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(!lazy)
  const containerRef = useRef<HTMLElement>(null)

  const h = useMemo(() => height || size, [height, size])
  const w = useMemo(() => width || size, [width, size])

  useEffect(() => {
    if (!lazy) return
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: lazyMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [lazy, lazyMargin])

  const handleError = () => {
    setShouldFallback(true)
    onError?.()
  }

  const handleLoad = () => {
    setLoaded(true)
    onLoad?.()
  }

  // Timeout: if the image hasn't loaded or errored within 10s, treat as failed
  useEffect(() => {
    if (loaded || shouldFallback || !visible) return
    const timer = setTimeout(() => {
      if (!loaded) handleError()
    }, 10_000)
    return () => clearTimeout(timer)
  }, [loaded, shouldFallback, visible])

  if (shouldFallback && fallback) {
    return (
      <>
        {fallback({
          height: h,
          width: w,
          className,
          src,
          alt,
          ...(fallbackProps || {}),
        })}
      </>
    )
  }

  const shapeClass = shape === 'circle' ? 'rounded-full' : 'rounded'
  const skeletonEl = skeleton ? (
    <div
      className={skeletonClassName || `absolute inset-0 ${shapeClass} bg-gray-200 dark:bg-surface-2`}
      style={loaded || shouldFallback ? { display: 'none' } : undefined}
    />
  ) : null

  const imgEl = visible && !shouldFallback ? (
    <img
      src={src}
      alt={alt}
      onError={handleError}
      onLoad={handleLoad}
      width={w}
      height={h}
      draggable={false}
      decoding="async"
      style={{
        ...style,
        width: w,
        height: h,
        ...(skeleton ? { opacity: loaded ? 1 : 0 } : {}),
      }}
      className={`${skeleton ? 'relative' : ''} ${className || ''}`}
    />
  ) : null

  const Tag = href ? 'a' : 'span'
  const linkProps = href ? { href, target: '_blank' as const, rel: 'noopener noreferrer' } : {}

  return (
    <Tag
      ref={containerRef as React.Ref<HTMLAnchorElement & HTMLSpanElement>}
      className={`shrink-0 relative inline-block ${skeleton ? '' : className || ''}`}
      style={{ width: w, height: h }}
      {...linkProps}
    >
      {skeletonEl}
      {imgEl}
    </Tag>
  )
}
