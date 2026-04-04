import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateImageFile, readFileAsDataUri, submitImage } from './image-upload'

// ---------------------------------------------------------------------------
// validateImageFile
// ---------------------------------------------------------------------------

describe('validateImageFile', () => {
  function makeFile(type: string, sizeBytes: number): File {
    // Build a Blob of the target size so file.size is accurate
    const content = new Uint8Array(sizeBytes)
    return new File([content], 'test-file', { type })
  }

  it('accepts valid PNG', () => {
    expect(validateImageFile(makeFile('image/png', 1024))).toBeNull()
  })

  it('accepts valid JPEG', () => {
    expect(validateImageFile(makeFile('image/jpeg', 1024))).toBeNull()
  })

  it('accepts valid GIF', () => {
    expect(validateImageFile(makeFile('image/gif', 1024))).toBeNull()
  })

  it('accepts valid WebP', () => {
    expect(validateImageFile(makeFile('image/webp', 1024))).toBeNull()
  })

  it('accepts valid SVG', () => {
    expect(validateImageFile(makeFile('image/svg+xml', 1024))).toBeNull()
  })

  it('rejects unsupported type (text/plain)', () => {
    const result = validateImageFile(makeFile('text/plain', 1024))
    expect(result).toMatch(/unsupported format/i)
    expect(result).toContain('text/plain')
  })

  it('rejects unsupported type (image/bmp)', () => {
    const result = validateImageFile(makeFile('image/bmp', 1024))
    expect(result).toMatch(/unsupported format/i)
  })

  it('rejects file exceeding 512KB', () => {
    const tooBig = 512 * 1024 + 1
    const result = validateImageFile(makeFile('image/png', tooBig))
    expect(result).toMatch(/too large/i)
    expect(result).toMatch(/512KB/i)
  })

  it('accepts file at the exact 512KB boundary', () => {
    const exact = 512 * 1024
    expect(validateImageFile(makeFile('image/png', exact))).toBeNull()
  })

  it('accepts file one byte under the limit', () => {
    const justUnder = 512 * 1024 - 1
    expect(validateImageFile(makeFile('image/png', justUnder))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// readFileAsDataUri
// ---------------------------------------------------------------------------

describe('readFileAsDataUri', () => {
  it('returns a data URI string for a simple file', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    const result = await readFileAsDataUri(file)
    expect(typeof result).toBe('string')
    expect(result.startsWith('data:')).toBe(true)
  })

  it('returns a data URI that contains the base64-encoded content', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    const result = await readFileAsDataUri(file)
    // base64('hello') = 'aGVsbG8='
    expect(result).toContain('aGVsbG8=')
  })
})

// ---------------------------------------------------------------------------
// submitImage
// ---------------------------------------------------------------------------

describe('submitImage', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('POSTs the correct payload and returns the result on success', async () => {
    const mockResult = { imageHash: '0xabc123', imageUrl: '/image/direct/0xabc123' }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResult,
    } as Response)

    const result = await submitImage(1, '0xdeadbeef', 'data:image/png;base64,abc')

    expect(result).toEqual(mockResult)
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledOnce()

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/images/submit')
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json' })

    const body = JSON.parse(options.body as string)
    expect(body).toEqual({
      chainId: 1,
      address: '0xdeadbeef',
      image: 'data:image/png;base64,abc',
      submittedBy: 'anon',
    })
  })

  it('throws with the server error message when response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid image format' }),
    } as Response)

    await expect(submitImage(1, '0xdeadbeef', 'data:image/png;base64,bad')).rejects.toThrow(
      'Invalid image format',
    )
  })

  it('throws a generic message when server returns non-ok with no error field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    await expect(submitImage(1, '0xdeadbeef', 'data:image/png;base64,bad')).rejects.toThrow(
      'Upload failed: 500',
    )
  })

  it('throws a fallback message when server returns non-ok and JSON parsing fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => { throw new Error('not json') },
    } as unknown as Response)

    await expect(submitImage(1, '0xdeadbeef', 'data:image/png;base64,bad')).rejects.toThrow(
      'Upload failed',
    )
  })
})
