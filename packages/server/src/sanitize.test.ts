import { describe, it, expect } from 'vitest'
import { sanitizeImage } from './sanitize'

describe('sanitizeImage', () => {
  describe('SVG sanitization', () => {
    it('strips <script> elements', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/><script>alert("xss")</script></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('<script')
      expect(output).not.toContain('alert')
      expect(output).toContain('<circle')
    })

    it('strips <foreignObject> elements', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>html</div></foreignObject><rect width="10" height="10"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('<foreignObject')
      expect(output).toContain('<rect')
    })

    it('strips onclick and other event handlers', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10" onclick="alert(1)" onmouseover="steal()"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('onclick')
      expect(output).not.toContain('onmouseover')
      expect(output).toContain('<circle')
    })

    it('strips javascript: URIs in href', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>click</text></a></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('javascript:')
    })

    it('strips <use> elements with external refs', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.com/payload.svg#icon"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('evil.com')
    })

    it('preserves valid SVG content', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ff0000"/><path d="M10 10 L90 90" stroke="black"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).toContain('<circle')
      expect(output).toContain('fill="#ff0000"')
      expect(output).toContain('<path')
      expect(output).toContain('viewBox')
    })

    it('strips <iframe> elements', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="https://evil.com"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      expect(result.toString()).not.toContain('<iframe')
    })

    it('strips non-image data: URIs', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="data:text/html,<script>alert(1)</script>"><text>x</text></a></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('data:text/html')
    })

    it('preserves data:image URIs', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBORw0KGgo="/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).toContain('data:image/png')
    })

    it('strips animate elements that target href', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="#"><animate attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('<animate')
    })

    it('handles case-insensitive element names', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT>alert(1)</SCRIPT><circle r="5"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('SCRIPT')
      expect(output).not.toContain('alert')
      expect(output).toContain('<circle')
    })
    it('strips CSS @import rules', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("https://evil.com/styles.css");</style><circle r="5"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('@import')
      expect(output).not.toContain('evil.com')
      expect(output).toContain('<circle')
    })

    it('strips file:// protocol URIs', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('file://')
      expect(output).not.toContain('/etc/passwd')
    })
  })

  describe('raster sanitization', () => {
    it('re-encodes PNG through sharp', async () => {
      // Create a minimal 1x1 red PNG
      const sharp = (await import('sharp')).default
      const original = await sharp({
        create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
      }).png().toBuffer()

      const result = await sanitizeImage(original, '.png')
      // Result should still be a valid PNG
      expect(result[0]).toBe(0x89) // PNG magic byte
      expect(result[1]).toBe(0x50) // P
      expect(result[2]).toBe(0x4e) // N
      expect(result[3]).toBe(0x47) // G
    })

    it('re-encodes JPEG through sharp', async () => {
      const sharp = (await import('sharp')).default
      const original = await sharp({
        create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 255 } },
      }).jpeg().toBuffer()

      const result = await sanitizeImage(original, '.jpg')
      // Result should still be a valid JPEG (starts with FF D8)
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xd8)
    })

    it('re-encodes WebP through sharp', async () => {
      const sharp = (await import('sharp')).default
      const original = await sharp({
        create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
      }).webp().toBuffer()

      const result = await sanitizeImage(original, '.webp')
      // RIFF header for WebP
      expect(result.toString('ascii', 0, 4)).toBe('RIFF')
    })

    it('returns unknown formats unchanged', async () => {
      const original = Buffer.from('not a real image format')
      const result = await sanitizeImage(original, '.xyz')
      expect(result.equals(original)).toBe(true)
    })

    it('returns corrupt images unchanged', async () => {
      const corrupt = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]) // truncated PNG header
      const result = await sanitizeImage(corrupt, '.png')
      // sharp can't process this — should return original
      expect(result.length).toBeGreaterThan(0)
    })
  })
})
