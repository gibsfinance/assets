/**
 * Tests for the documentation server: the generated guides (read from a temporary directory
 * standing in for the documentation build output) and the terms page, which is read from the
 * real docs/ directory the way a request in production would.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Request, Response, NextFunction } from 'express'
import {
  createSkillDocHandler,
  getSkillDoc as defaultSkillDoc,
  getTerms,
  DOCS_PATH,
  GENERATED_SKILLS_PATH,
} from './docs'

vi.mock('../../config', () => ({ default: { cacheSeconds: 3600 } }))

function mockRequest(params: Record<string, string> = {}): Request {
  return { params } as unknown as Request
}

function mockResponse(): Response {
  const res: Record<string, unknown> = {}
  res.set = vi.fn().mockReturnValue(res)
  res.type = vi.fn().mockReturnValue(res)
  res.send = vi.fn().mockReturnValue(res)
  return res as unknown as Response
}

describe('docs', () => {
  it('resolves DOCS_PATH under the repository docs/ directory', () => {
    expect(DOCS_PATH.endsWith('/docs')).toBe(true)
  })

  describe('createSkillDocHandler', () => {
    let generatedDirectory: string

    beforeAll(() => {
      generatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-docs-'))
      fs.writeFileSync(path.join(generatedDirectory, 'api-reference.md'), '# Gib.Show API Reference')
    })

    afterAll(() => {
      fs.rmSync(generatedDirectory, { recursive: true, force: true })
    })

    const send = async (filename: string) => {
      const res = mockResponse()
      const next = vi.fn() as unknown as NextFunction
      await createSkillDocHandler({ generatedDirectory })(mockRequest({ filename }), res, next)
      return { res, next }
    }

    it('serves a generated guide as text/markdown with a public cache-control header', async () => {
      const { res, next } = await send('api-reference.md')
      expect(next).not.toHaveBeenCalled()
      expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=3600')
      expect(res.type).toHaveBeenCalledWith('text/markdown')
      expect((res.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('# Gib.Show API Reference')
    })

    it('falls through to next() for a filename that is not a bare name ending in .md', async () => {
      const { res, next } = await send('api-reference')
      expect(next).toHaveBeenCalledWith()
      expect(res.send).not.toHaveBeenCalled()
    })

    it('falls through to next() for a traversal attempt smuggled through the filename param', async () => {
      const { res, next } = await send('../../package.json')
      expect(next).toHaveBeenCalledWith()
      expect(res.send).not.toHaveBeenCalled()
    })

    it('falls through to next() for a guide the build has not produced', async () => {
      const { res, next } = await send('does-not-exist.md')
      expect(next).toHaveBeenCalledWith()
      expect(res.send).not.toHaveBeenCalled()
    })
  })

  describe('getSkillDoc', () => {
    it('reads the documentation build output by default', async () => {
      expect(GENERATED_SKILLS_PATH.endsWith('/docs/dist/skills')).toBe(true)
      // A traversal attempt is refused before any directory is read, with the real default handler too.
      const next = vi.fn() as unknown as NextFunction
      await defaultSkillDoc(mockRequest({ filename: '../x.md' }), mockResponse(), next)
      expect(next).toHaveBeenCalledWith()
    })
  })

  describe('getTerms', () => {
    it('serves the real terms page as text/markdown', async () => {
      const req = mockRequest()
      const res = mockResponse()
      const next = vi.fn() as unknown as NextFunction

      await getTerms(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=3600')
      expect(res.type).toHaveBeenCalledWith('text/markdown')
      const [sentContent] = (res.send as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(sentContent).toContain('Terms and attribution')
    })
  })
})
