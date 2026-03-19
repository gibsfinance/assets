import { useState, useMemo, type ReactNode, type CSSProperties } from 'react'

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
  onError?: () => void
  fallback?: (props: FallbackProps) => ReactNode
  fallbackProps?: FallbackProps
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
}: ImageProps) {
  const [shouldFallback, setShouldFallback] = useState(false)

  const h = useMemo(() => height || size, [height, size])
  const w = useMemo(() => width || size, [width, size])

  const handleFallback = () => {
    setShouldFallback(true)
    onError?.()
  }

  if (shouldFallback) {
    if (fallback) {
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
    return (
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        style={style}
        className={className}
      />
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={handleFallback}
      width={w}
      height={h}
      style={style}
      className={className}
    />
  )
}
