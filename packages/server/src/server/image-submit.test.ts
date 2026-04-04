import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Mock the db module so the transitive import chain (db -> log -> App.tsx JSX)
 * never loads during tests for the pure-function coverage here.
 */
vi.mock('../db', () => ({
  insertImage: vi.fn(),
}))

/**
 * Mock file-type so the ESM-only package doesn't cause transform issues.
 */
vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}))

import { parseDataUri, router } from './image-submit'
import * as db from '../db'
import * as fileType from 'file-type'
import type { Request, Response, NextFunction } from 'express'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the route handler from the router. Express stores routes in
 * router.stack. We find the POST /submit layer and call its handler chain.
 */
function getSubmitHandler(): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const layer = (router as any).stack.find((l: any) => l.route && l.route.path === '/submit' && l.route.methods.post)
  if (!layer) throw new Error('POST /submit route not found on router')
  // The route has two handlers: json() middleware and our nextOnError wrapper.
  // We want the second one (the actual handler wrapped by nextOnError).
  const handlers = layer.route.stack.map((s: any) => s.handle)
  // Return the last handler (the one wrapped by nextOnError)
  return handlers[handlers.length - 1]
}

function mockRequest(body: Record<string, unknown>): Request {
  return { body } as unknown as Request
}

function mockResponse(): Response {
  const res: Record<string, unknown> = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res as unknown as Response
}

/** Build a small valid PNG data URI */
function validPngDataUri(sizeBytes?: number): string {
  const size = sizeBytes ?? 100
  const buf = Buffer.alloc(size, 0)
  return `data:image/png;base64,${buf.toString('base64')}`
}

/** Build a valid SVG data URI */
function validSvgDataUri(): string {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseDataUri', () => {
  it('returns mime and buffer for a valid PNG data URI', () => {
    // Minimal 1x1 PNG in base64
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const dataUri = `data:image/png;base64,${base64}`

    const result = parseDataUri(dataUri)

    expect(result).not.toBeNull()
    expect(result!.mime).toBe('image/png')
    expect(Buffer.isBuffer(result!.buffer)).toBe(true)
    expect(result!.buffer.length).toBeGreaterThan(0)
  })

  it('returns mime and buffer for a valid SVG data URI', () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'
    const base64 = Buffer.from(svgContent).toString('base64')
    const dataUri = `data:image/svg+xml;base64,${base64}`

    const result = parseDataUri(dataUri)

    expect(result).not.toBeNull()
    expect(result!.mime).toBe('image/svg+xml')
    expect(result!.buffer.toString('utf8')).toBe(svgContent)
  })

  it('returns null for a string without the data: prefix', () => {
    expect(parseDataUri('https://example.com/image.png')).toBeNull()
    expect(parseDataUri('image.png')).toBeNull()
    expect(parseDataUri('')).toBeNull()
  })

  it('returns null for a malformed data URI missing the base64 content', () => {
    // has the prefix and semicolon but no content after the comma
    expect(parseDataUri('data:image/png;base64,')).toBeNull()
    // missing the ;base64, segment entirely
    expect(parseDataUri('data:image/png')).toBeNull()
  })

  it('decodes base64 content to the original bytes', () => {
    const original = 'hello world'
    const base64 = Buffer.from(original).toString('base64')
    const dataUri = `data:text/plain;base64,${base64}`

    const result = parseDataUri(dataUri)

    expect(result).not.toBeNull()
    expect(result!.buffer.toString('utf8')).toBe(original)
  })
})

describe('POST /submit handler', () => {
  let handler: (req: Request, res: Response, next: NextFunction) => Promise<void>

  beforeEach(() => {
    vi.clearAllMocks()
    handler = getSubmitHandler()
  })

  it('returns 400 when required fields are missing', async () => {
    const res = mockResponse()
    const next = vi.fn()

    // Missing all fields
    await handler(mockRequest({}), res, next)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Missing required fields') }),
    )
  })

  it('returns 400 when chainId is missing', async () => {
    const res = mockResponse()
    await handler(
      mockRequest({ address: '0xabc', image: 'data:image/png;base64,abc', submittedBy: 'anon' }),
      res,
      vi.fn(),
    )
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 400 when image is not a data URI', async () => {
    const res = mockResponse()
    await handler(
      mockRequest({ chainId: 1, address: '0xabc', image: 'https://example.com/img.png', submittedBy: 'anon' }),
      res,
      vi.fn(),
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('data URI') }))
  })

  it('returns 400 when image is not a string', async () => {
    const res = mockResponse()
    await handler(mockRequest({ chainId: 1, address: '0xabc', image: 12345, submittedBy: 'anon' }), res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('data URI') }))
  })

  it('returns 400 for invalid data URI format', async () => {
    const res = mockResponse()
    await handler(
      mockRequest({
        chainId: 1,
        address: '0xabc',
        image: 'data:image/png;notbase64,stuff',
        submittedBy: 'anon',
      }),
      res,
      vi.fn(),
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Invalid data URI format') }),
    )
  })

  it('returns 400 when image exceeds 512KB', async () => {
    const largeBuffer = Buffer.alloc(513 * 1024, 0)
    const dataUri = `data:image/png;base64,${largeBuffer.toString('base64')}`

    const res = mockResponse()
    await handler(mockRequest({ chainId: 1, address: '0xabc', image: dataUri, submittedBy: 'anon' }), res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('512KB') }))
  })

  it('returns 400 for unrecognized image format', async () => {
    // file-type returns null (unrecognized) and content does not contain <svg
    vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue(undefined as any)

    const textContent = 'this is plain text, not an image'
    const dataUri = `data:application/octet-stream;base64,${Buffer.from(textContent).toString('base64')}`

    const res = mockResponse()
    await handler(mockRequest({ chainId: 1, address: '0xabc', image: dataUri, submittedBy: 'anon' }), res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Unrecognized image format') }),
    )
  })

  it('returns 400 when file-type detects non-image mime', async () => {
    vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue({
      mime: 'application/pdf',
      ext: 'pdf',
    } as any)

    const res = mockResponse()
    await handler(
      mockRequest({ chainId: 1, address: '0xabc', image: validPngDataUri(), submittedBy: 'anon' }),
      res,
      vi.fn(),
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Unrecognized image format') }),
    )
  })

  it('accepts SVG via content sniffing when file-type returns undefined', async () => {
    vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue(undefined as any)
    vi.mocked(db.insertImage).mockResolvedValue({
      image: { imageHash: 'svghash123' },
    } as any)

    const res = mockResponse()
    await handler(
      mockRequest({ chainId: 1, address: '0xabc', image: validSvgDataUri(), submittedBy: 'anon' }),
      res,
      vi.fn(),
    )
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        imageHash: 'svghash123',
        imageUrl: '/image/direct/svghash123',
      }),
    )
  })

  it('returns 201 with imageHash on success', async () => {
    vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue({
      mime: 'image/png',
      ext: 'png',
    } as any)
    vi.mocked(db.insertImage).mockResolvedValue({
      image: { imageHash: 'hash456' },
    } as any)

    const res = mockResponse()
    await handler(
      mockRequest({ chainId: 1, address: '0xabc', image: validPngDataUri(), submittedBy: 'anon' }),
      res,
      vi.fn(),
    )
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      imageHash: 'hash456',
      imageUrl: '/image/direct/hash456',
    })
  })

  it('passes correct providerKey and originalUri to insertImage', async () => {
    vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue({
      mime: 'image/png',
      ext: 'png',
    } as any)
    vi.mocked(db.insertImage).mockResolvedValue({
      image: { imageHash: 'hash789' },
    } as any)

    const res = mockResponse()
    await handler(
      mockRequest({
        chainId: 42,
        address: '0xAbC',
        image: validPngDataUri(),
        submittedBy: 'alice',
      }),
      res,
      vi.fn(),
    )

    expect(db.insertImage).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKey: 'user-submit',
        originalUri: 'submit://alice/42/0xabc',
        listId: null,
      }),
    )
  })

  it('returns 400 when insertImage returns null', async () => {
    vi.mocked(fileType.fileTypeFromBuffer).mockResolvedValue({
      mime: 'image/png',
      ext: 'png',
    } as any)
    vi.mocked(db.insertImage).mockResolvedValue(null)

    const res = mockResponse()
    await handler(
      mockRequest({ chainId: 1, address: '0xabc', image: validPngDataUri(), submittedBy: 'anon' }),
      res,
      vi.fn(),
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Failed to process image') }),
    )
  })
})
