/**
 * Tests for the repository documentation server: the hand-written guides
 * under docs/skills/ and the terms page, both served straight off disk.
 *
 * No filesystem mocking — the whole point of this module is that its paths
 * resolve against the real repository layout (see docs.ts's own comment on
 * why), so these tests read the real docs/ directory the way a request in
 * production would.
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
  SKILLS_DOCS_PATH,
} from './docs'

vi.mock('../../config', () => ({ default: { cacheSeconds: 3600 } }))

// The behaviour tests read the hand-written guides: a documentation build on this machine
// must not change what they see, so the generated directory is one that never exists.
const getSkillDoc = createSkillDocHandler({
  generatedDirectory: path.join(os.tmpdir(), 'no-generated-guides-here'),
  fallbackDirectory: SKILLS_DOCS_PATH,
})

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
  it('resolves DOCS_PATH and SKILLS_DOCS_PATH under the repository docs/ directory', () => {
    expect(DOCS_PATH.endsWith('/docs')).toBe(true)
    expect(SKILLS_DOCS_PATH.endsWith('/docs/skills')).toBe(true)
  })

  describe('getSkillDoc', () => {
    it('serves a real guide as text/markdown with a public cache-control header', async () => {
      const req = mockRequest({ filename: 'api-reference.md' })
      const res = mockResponse()
      const next = vi.fn() as unknown as NextFunction

      await getSkillDoc(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=3600')
      expect(res.type).toHaveBeenCalledWith('text/markdown')
      const [sentContent] = (res.send as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(sentContent).toContain('# Gib.Show API Reference')
      // The guide used to document the output-format parameter as `format`,
      // which the code never implemented — every occurrence was corrected to `as`.
      expect(sentContent).not.toMatch(/[?&]format=webp/)
    })

    it('serves each of the other published guides', async () => {
      for (const filename of ['list-management.md', 'self-hosting.md']) {
        const req = mockRequest({ filename })
        const res = mockResponse()
        const next = vi.fn() as unknown as NextFunction

        await getSkillDoc(req, res, next)

        expect(next).not.toHaveBeenCalled()
        expect(res.type).toHaveBeenCalledWith('text/markdown')
      }
    })

    it('falls through to next() for a filename that is not a bare name ending in .md', async () => {
      const req = mockRequest({ filename: 'api-reference' })
      const res = mockResponse()
      const next = vi.fn() as unknown as NextFunction

      await getSkillDoc(req, res, next)

      expect(next).toHaveBeenCalledWith()
      expect(res.send).not.toHaveBeenCalled()
    })

    it('falls through to next() for a traversal attempt smuggled through the filename param', async () => {
      const req = mockRequest({ filename: '../../package.json' })
      const res = mockResponse()
      const next = vi.fn() as unknown as NextFunction

      await getSkillDoc(req, res, next)

      expect(next).toHaveBeenCalledWith()
      expect(res.send).not.toHaveBeenCalled()
    })

    it('falls through to next() for a well-formed filename that does not exist on disk', async () => {
      const req = mockRequest({ filename: 'does-not-exist.md' })
      const res = mockResponse()
      const next = vi.fn() as unknown as NextFunction

      await getSkillDoc(req, res, next)

      expect(next).toHaveBeenCalledWith()
      expect(res.send).not.toHaveBeenCalled()
    })
  })

  describe('generated guides', () => {
    let generatedDirectory: string
    let fallbackDirectory: string

    beforeAll(() => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-docs-'))
      generatedDirectory = path.join(root, 'generated')
      fallbackDirectory = path.join(root, 'fallback')
      fs.mkdirSync(generatedDirectory)
      fs.mkdirSync(fallbackDirectory)
      fs.writeFileSync(path.join(generatedDirectory, 'both.md'), '# generated copy')
      fs.writeFileSync(path.join(fallbackDirectory, 'both.md'), '# hand-written copy')
      fs.writeFileSync(path.join(fallbackDirectory, 'old-only.md'), '# hand-written only')
    })

    afterAll(() => {
      fs.rmSync(path.dirname(generatedDirectory), { recursive: true, force: true })
    })

    const send = async (filename: string) => {
      const res = mockResponse()
      const next = vi.fn() as unknown as NextFunction
      await createSkillDocHandler({ generatedDirectory, fallbackDirectory })(mockRequest({ filename }), res, next)
      return { res, next }
    }

    it('prefers the generated copy over the hand-written one', async () => {
      const { res, next } = await send('both.md')
      expect(next).not.toHaveBeenCalled()
      expect((res.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('# generated copy')
    })

    it('falls back to the hand-written copy when the build did not produce that guide', async () => {
      const { res } = await send('old-only.md')
      expect((res.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('# hand-written only')
    })

    it('falls through to next() when neither directory has the guide', async () => {
      const { res, next } = await send('neither.md')
      expect(next).toHaveBeenCalledWith()
      expect(res.send).not.toHaveBeenCalled()
    })

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
