import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Global fetch mock — stubbed once at module level, reset between tests
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// Image mock helpers
// ---------------------------------------------------------------------------
function makeImageClass(width: number, height: number, fail: boolean) {
  function MockImage(this: Record<string, unknown>) {
    this.crossOrigin = ''
    this.naturalWidth = width
    this.naturalHeight = height
    this.onload = null
    this.onerror = null
    Object.defineProperty(this, 'src', {
      set(_value: string) {
        const self = this as Record<string, ((...args: unknown[]) => void) | null>
        if (fail) {
          Promise.resolve().then(() => self.onerror?.(new Error('Image load failed')))
        } else {
          Promise.resolve().then(() => self.onload?.())
        }
      },
    })
  }
  return MockImage
}

let restoreImage: (() => void) | null = null

function stubImageLoad(width = 32, height = 32) {
  const original = globalThis.Image
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).Image = makeImageClass(width, height, false)
  restoreImage = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).Image = original
  }
}

function stubImageError() {
  const original = globalThis.Image
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).Image = makeImageClass(0, 0, true)
  restoreImage = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).Image = original
  }
}

// ---------------------------------------------------------------------------
// Wrapper factory — fresh QueryClient per test to prevent cross-test caching
// ---------------------------------------------------------------------------
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useImageMetadata', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    restoreImage?.()
    restoreImage = null
  })

  it('returns null metadata and isLoading=false when url is null (no fetch)', async () => {
    const { useImageMetadata } = await import('./useImageMetadata')
    const { result } = renderHook(() => useImageMetadata(null), {
      wrapper: createWrapper(),
    })

    expect(result.current.metadata).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fetches metadata via HEAD request and returns format/size/dimensions', async () => {
    mockFetch.mockResolvedValue({
      headers: {
        get: (name: string) => {
          if (name === 'content-type') return 'image/png'
          if (name === 'content-length') return '4096'
          return null
        },
      },
    })
    stubImageLoad(64, 64)

    const { useImageMetadata } = await import('./useImageMetadata')
    const { result } = renderHook(() => useImageMetadata('https://example.com/token.png'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.metadata).not.toBeNull())

    expect(result.current.isLoading).toBe(false)
    expect(result.current.metadata?.format).toBe('PNG')
    expect(result.current.metadata?.fileSize).toBe(4096)
    expect(result.current.metadata?.contentType).toBe('image/png')
    expect(result.current.metadata?.width).toBe(64)
    expect(result.current.metadata?.height).toBe(64)
  })

  it('returns SVG format without attempting Image decode for SVG content-type', async () => {
    mockFetch.mockResolvedValue({
      headers: {
        get: (name: string) => {
          if (name === 'content-type') return 'image/svg+xml'
          if (name === 'content-length') return '1024'
          return null
        },
      },
    })

    const { useImageMetadata } = await import('./useImageMetadata')
    const { result } = renderHook(() => useImageMetadata('https://example.com/token.svg'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.metadata).not.toBeNull())

    expect(result.current.metadata?.format).toBe('SVG')
    expect(result.current.metadata?.width).toBeNull()
    expect(result.current.metadata?.height).toBeNull()
    expect(result.current.metadata?.fileSize).toBe(1024)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/token.svg', { method: 'HEAD' })
  })

  it('React Query deduplicates concurrent fetches for the same url (single fetch)', async () => {
    mockFetch.mockResolvedValue({
      headers: {
        get: (name: string) => {
          if (name === 'content-type') return 'image/webp'
          if (name === 'content-length') return '2048'
          return null
        },
      },
    })
    stubImageLoad(128, 128)

    // Use a single QueryClient so both hooks share the query cache
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)

    const { useImageMetadata } = await import('./useImageMetadata')

    const url = 'https://example.com/shared.webp'
    const { result: r1 } = renderHook(() => useImageMetadata(url), { wrapper })
    const { result: r2 } = renderHook(() => useImageMetadata(url), { wrapper })

    await waitFor(() => expect(r1.current.metadata).not.toBeNull())
    await waitFor(() => expect(r2.current.metadata).not.toBeNull())

    expect(r1.current.metadata?.format).toBe('WEBP')
    expect(r2.current.metadata?.format).toBe('WEBP')
    // fetch called only once despite two hooks observing the same query
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('gracefully handles HEAD fetch failure and still attempts Image decode', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    stubImageError()

    const { useImageMetadata } = await import('./useImageMetadata')
    const { result } = renderHook(() => useImageMetadata('https://example.com/bad.png'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.metadata).not.toBeNull())

    expect(result.current.metadata?.format).toBe('unknown')
    expect(result.current.metadata?.fileSize).toBeNull()
    expect(result.current.metadata?.width).toBeNull()
    expect(result.current.metadata?.height).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// fetchImageMetadata (pure function)
// ---------------------------------------------------------------------------
describe('fetchImageMetadata', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    restoreImage?.()
    restoreImage = null
  })

  it('returns correct metadata for a PNG url', async () => {
    mockFetch.mockResolvedValue({
      headers: {
        get: (name: string) => {
          if (name === 'content-type') return 'image/png'
          if (name === 'content-length') return '512'
          return null
        },
      },
    })
    stubImageLoad(16, 16)

    const { fetchImageMetadata } = await import('./useImageMetadata') as typeof import('./useImageMetadata')
    const result = await fetchImageMetadata('https://example.com/tiny.png')

    expect(result.format).toBe('PNG')
    expect(result.fileSize).toBe(512)
    expect(result.width).toBe(16)
    expect(result.height).toBe(16)
    expect(result.contentType).toBe('image/png')
  })

  it('returns format=unknown when HEAD returns an unrecognised content-type', async () => {
    mockFetch.mockResolvedValue({
      headers: {
        get: (name: string) => {
          if (name === 'content-type') return 'application/octet-stream'
          if (name === 'content-length') return '256'
          return null
        },
      },
    })
    stubImageError()

    const { fetchImageMetadata } = await import('./useImageMetadata') as typeof import('./useImageMetadata')
    const result = await fetchImageMetadata('https://example.com/binary.bin')

    expect(result.format).toBe('unknown')
    expect(result.fileSize).toBe(256)
    expect(result.contentType).toBe('application/octet-stream')
  })
})
