import {
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { Icon } from '@iconify/react'
import Image from './Image'

export interface TokenPreviewHandle {
  resetPreview: () => void
}

interface TokenPreviewProps {
  url: string
  previewError: boolean
  iconExists: boolean
  isCircularCrop: boolean
  backgroundColor: string
  showColorPicker: boolean
  setPreviewError: (value: boolean) => void
  setIconExists: (value: boolean) => void
  setIsCircularCrop: (value: boolean) => void
  setBackgroundColor: (value: string) => void
  setShowColorPicker: (value: boolean) => void
}

const TokenPreview = forwardRef<TokenPreviewHandle, TokenPreviewProps>(
  function TokenPreview(
    {
      url,
      previewError: _previewError,
      iconExists: _iconExists,
      isCircularCrop,
      backgroundColor,
      showColorPicker,
      setPreviewError,
      setIconExists,
      setIsCircularCrop,
      setBackgroundColor,
      setShowColorPicker,
    },
    ref,
  ) {
    const [zoomLevel, setZoomLevel] = useState(1)
    const [isDragging, setIsDragging] = useState(false)
    const [startX, setStartX] = useState(0)
    const [startY, setStartY] = useState(0)
    const [translateX, setTranslateX] = useState(0)
    const [translateY, setTranslateY] = useState(0)

    useImperativeHandle(ref, () => ({
      resetPreview() {
        setZoomLevel(1)
        setTranslateX(0)
        setTranslateY(0)
        setIsCircularCrop(false)
        setShowColorPicker(false)
        setBackgroundColor('#2b4f54')
        setPreviewError(false)
        setIconExists(true)
      },
    }))

    const handleZoomIn = useCallback(() => {
      setZoomLevel((prev) => Math.min(prev + 0.5, 4))
    }, [])

    const handleZoomOut = useCallback(() => {
      setZoomLevel((prev) => Math.max(prev - 0.5, 0.5))
    }, [])

    const handleMouseDown = useCallback(
      (event: ReactMouseEvent) => {
        setIsDragging(true)
        setStartX(event.clientX - translateX)
        setStartY(event.clientY - translateY)
      },
      [translateX, translateY],
    )

    const handleMouseMove = useCallback(
      (event: ReactMouseEvent) => {
        if (!isDragging) return
        setTranslateX(event.clientX - startX)
        setTranslateY(event.clientY - startY)
      },
      [isDragging, startX, startY],
    )

    const handleMouseUp = useCallback(() => {
      setIsDragging(false)
    }, [])

    const handleWheel = useCallback((event: ReactWheelEvent) => {
      event.preventDefault()
      const delta = -Math.sign(event.deltaY)
      const zoomStep = 0.1
      if (delta > 0) {
        setZoomLevel((prev) => Math.min(prev + zoomStep, 4))
      } else {
        setZoomLevel((prev) => Math.max(prev - zoomStep, 0.5))
      }
    }, [])

    const handleColorInput = useCallback(
      (event: React.FormEvent<HTMLInputElement>) => {
        setBackgroundColor(event.currentTarget.value)
      },
      [setBackgroundColor],
    )

    const handleColorTextInput = useCallback(
      (event: React.FormEvent<HTMLInputElement>) => {
        const value = event.currentTarget.value.trim()
        if (value.match(/^#[0-9A-Fa-f]{6}$/)) {
          setBackgroundColor(value)
        } else if (value.match(/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/)) {
          setBackgroundColor(value)
        } else if (
          value.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/)
        ) {
          setBackgroundColor(value)
        }
      },
      [setBackgroundColor],
    )

    const handleImageError = useCallback(() => {
      setPreviewError(true)
      setIconExists(false)
    }, [setPreviewError, setIconExists])

    return (
      <>
        {/* Preview card */}
        <div className="card variant-ghost space-y-2">
          <div className="flex items-center justify-between">
            <span className="label">Preview</span>
            <div className="flex gap-2">
              <button
                className="variant-soft-surface btn btn-sm"
                onClick={handleZoomOut}
                disabled={zoomLevel <= 0.5}
                aria-label="Zoom out"
              >
                <i className="fas fa-minus"></i>
              </button>
              <span className="flex items-center px-2 text-sm">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                className="variant-soft-surface btn btn-sm"
                onClick={handleZoomIn}
                disabled={zoomLevel >= 4}
                aria-label="Zoom in"
              >
                <i className="fas fa-plus"></i>
              </button>
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <button
              type="button"
              className={`relative h-[300px] w-full cursor-move overflow-hidden ${showColorPicker ? '' : 'checkerboard'} border border-surface-700/20`}
              style={{
                backgroundColor: showColorPicker ? backgroundColor : undefined,
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
              role="slider"
              aria-label="Token preview zoom control"
              aria-valuemin={50}
              aria-valuemax={400}
              aria-valuenow={Math.round(zoomLevel * 100)}
              aria-valuetext={`${Math.round(zoomLevel * 100)}% zoom`}
            >
              <Image
                alt="Icon preview"
                src={url}
                className={`user-drag-none absolute left-1/2 top-1/2 transition-transform duration-100 ${isCircularCrop ? 'rounded-full' : ''}`}
                style={{
                  transform: `translate(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px)) scale(${zoomLevel})`,
                }}
                size={64}
                onError={handleImageError}
                fallback={() => <Icon icon="nrk:404" className="h-12 w-12" />}
              />
            </button>
            <div className="mt-2 text-center text-sm text-gray-400">
              <span className="opacity-75">
                Click and drag to pan &bull; Scroll to zoom
              </span>
            </div>
          </div>
        </div>

        {/* Preview Options */}
        <div className="card variant-ghost space-y-4">
          <span className="label">Preview Options</span>
          <div className="flex flex-col gap-4">
            {/* Crop Option */}
            <div className="flex items-center gap-2">
              <button
                className={`variant-soft btn btn-sm transition-all ${isCircularCrop ? 'shadow-lg shadow-[#00DC82]/15' : ''}`}
                onClick={() => setIsCircularCrop(!isCircularCrop)}
              >
                <i className="fas fa-circle mr-2"></i>
                Circle Crop
              </button>
            </div>

            {/* Background Options */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  className={`variant-soft btn btn-sm transition-all ${showColorPicker ? 'shadow-lg shadow-[#00DC82]/15' : ''}`}
                  onClick={() => setShowColorPicker(!showColorPicker)}
                >
                  <i className="fas fa-fill-drip mr-2"></i>
                  {showColorPicker ? 'Hide Color Options' : 'Custom Background'}
                </button>
              </div>

              {showColorPicker && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* Color Picker */}
                  <div className="space-y-2">
                    <label htmlFor="color-picker" className="text-sm">
                      Pick a color:
                    </label>
                    <input
                      id="color-picker"
                      type="color"
                      className="h-10 w-full cursor-pointer rounded"
                      value={backgroundColor}
                      onInput={handleColorInput}
                    />
                  </div>

                  {/* Color Input */}
                  <div className="space-y-2">
                    <label htmlFor="color-text" className="text-sm">
                      Or enter a color value:
                    </label>
                    <input
                      id="color-text"
                      type="text"
                      className="input"
                      placeholder="#HEX, rgb(), rgba()"
                      value={backgroundColor}
                      onInput={handleColorTextInput}
                    />
                    <p className="text-xs opacity-75">
                      Supports HEX (#RRGGBB), RGB (rgb(r,g,b)), and RGBA
                      (rgba(r,g,b,a))
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    )
  },
)

export default TokenPreview
