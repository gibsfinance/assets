import { describe, expect, it } from 'vitest'
import {
  IDENTITY_TRANSFORM,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  panBy,
  screenToContent,
  zoomAtPointer,
  type CanvasTransform,
} from './canvas-transform'

describe('clampZoom', () => {
  it('holds the value at the ceiling when it is above MAX_ZOOM', () => {
    expect(clampZoom(MAX_ZOOM + 10)).toBe(MAX_ZOOM)
  })

  it('holds the value at the floor when it is below MIN_ZOOM', () => {
    expect(clampZoom(MIN_ZOOM - 0.1)).toBe(MIN_ZOOM)
  })

  it('passes an in-range value through untouched', () => {
    expect(clampZoom(1.5)).toBe(1.5)
  })
})

describe('panBy', () => {
  it('adds the screen-space delta to x and y and leaves zoom alone', () => {
    const transform: CanvasTransform = { x: 10, y: 20, zoom: 1.5 }
    const result = panBy(transform, 5, -3)
    expect(result).toEqual({ x: 15, y: 17, zoom: 1.5 })
  })

  it('returns a new object and does not mutate the input transform', () => {
    const transform: CanvasTransform = { x: 10, y: 20, zoom: 1.5 }
    const original = { ...transform }
    panBy(transform, 5, -3)
    expect(transform).toEqual(original)
  })
})

describe('zoomAtPointer', () => {
  it('keeps the content point under the cursor fixed under the cursor', () => {
    const transform: CanvasTransform = { x: 10, y: -5, zoom: 1.5 }
    const gesture = { pointerX: 120, pointerY: 40, deltaY: -150 }
    const contentUnderPointerBefore = screenToContent(transform, gesture.pointerX, gesture.pointerY)

    const nextTransform = zoomAtPointer(transform, gesture)
    const contentUnderPointerAfter = screenToContent(nextTransform, gesture.pointerX, gesture.pointerY)

    expect(contentUnderPointerAfter.x).toBeCloseTo(contentUnderPointerBefore.x)
    expect(contentUnderPointerAfter.y).toBeCloseTo(contentUnderPointerBefore.y)
  })

  it('zooms in when deltaY is negative', () => {
    const transform: CanvasTransform = { x: 0, y: 0, zoom: 1 }
    const result = zoomAtPointer(transform, { pointerX: 50, pointerY: 50, deltaY: -100 })
    expect(result.zoom).toBeGreaterThan(transform.zoom)
  })

  it('zooms out when deltaY is positive', () => {
    const transform: CanvasTransform = { x: 0, y: 0, zoom: 1 }
    const result = zoomAtPointer(transform, { pointerX: 50, pointerY: 50, deltaY: 100 })
    expect(result.zoom).toBeLessThan(transform.zoom)
  })

  it('stops at MAX_ZOOM and leaves the offsets unchanged when the zoom does not move', () => {
    const transform: CanvasTransform = { x: 12, y: 34, zoom: MAX_ZOOM }
    const result = zoomAtPointer(transform, { pointerX: 200, pointerY: 300, deltaY: -1000 })
    expect(result.zoom).toBe(MAX_ZOOM)
    expect(result.x).toBe(transform.x)
    expect(result.y).toBe(transform.y)
  })

  it('stops at MIN_ZOOM and leaves the offsets unchanged when the zoom does not move', () => {
    const transform: CanvasTransform = { x: 12, y: 34, zoom: MIN_ZOOM }
    const result = zoomAtPointer(transform, { pointerX: 200, pointerY: 300, deltaY: 1000 })
    expect(result.zoom).toBe(MIN_ZOOM)
    expect(result.x).toBe(transform.x)
    expect(result.y).toBe(transform.y)
  })
})

describe('IDENTITY_TRANSFORM', () => {
  it('is frozen, so a caller cannot write to the shared constant', () => {
    expect(Object.isFrozen(IDENTITY_TRANSFORM)).toBe(true)
  })

  it('stays intact after panBy reads it to build a new transform', () => {
    const before = { ...IDENTITY_TRANSFORM }
    panBy(IDENTITY_TRANSFORM, 10, 10)
    expect(IDENTITY_TRANSFORM).toEqual(before)
  })
})

describe('screenToContent', () => {
  it('inverts the transform that placed the content on screen', () => {
    const transform: CanvasTransform = { x: 10, y: 20, zoom: 2 }
    const contentX = 5
    const contentY = 7
    const screenX = transform.x + contentX * transform.zoom
    const screenY = transform.y + contentY * transform.zoom

    const result = screenToContent(transform, screenX, screenY)

    expect(result.x).toBeCloseTo(contentX)
    expect(result.y).toBeCloseTo(contentY)
  })
})
