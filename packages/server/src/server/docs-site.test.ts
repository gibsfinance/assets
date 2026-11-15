/**
 * The documentation site is served by host name, from the same process as the API.
 *
 * Both directions matter: the site must answer on its own host and nothing else may, and the
 * site must not answer on the main host. These tests run the real handler, over a real
 * directory, behind a stand-in for the application, and set the Host header by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express from 'express'
import { createDocsSiteHandler, docsCacheHeaders, DOCS_SITE_PATH, isDocsHost } from './docs-site'
import { IMAGE_SECURITY_HEADERS } from './image/headers'

/** A response, read whole. */
interface ReadResponse {
  status: number
  headers: { get: (name: string) => string | null }
  text: () => Promise<string>
  json: () => Promise<unknown>
}

/**
 * Send a request with a chosen Host header. `fetch` refuses to set that header, and the header is
 * the thing under test, so this uses the plain http client.
 */
const requestWithHost = (address: string, urlPath: string, host: string, method = 'GET'): Promise<ReadResponse> =>
  new Promise((resolve, reject) => {
    const request = http.request(`${address}${urlPath}`, { method, headers: { host } }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: response.statusCode ?? 0,
          headers: { get: (name) => (response.headers[name.toLowerCase()] as string | undefined) ?? null },
          text: async () => body,
          json: async () => JSON.parse(body),
        })
      })
    })
    request.on('error', reject)
    request.end()
  })

describe('isDocsHost', () => {
  it('matches a configured name, ignoring case', () => {
    expect(isDocsHost('docs.example.test', ['docs.example.test'])).toBe(true)
    expect(isDocsHost('DOCS.Example.test', ['docs.example.test'])).toBe(true)
  })

  it('matches any of several names', () => {
    expect(isDocsHost('b.test', ['a.test', 'b.test'])).toBe(true)
  })

  it('does not match a different name, a parent name or a name that only contains one', () => {
    expect(isDocsHost('example.test', ['docs.example.test'])).toBe(false)
    expect(isDocsHost('docs.example.test.evil.test', ['docs.example.test'])).toBe(false)
    expect(isDocsHost('evil-docs.example.test', ['docs.example.test'])).toBe(false)
  })

  it('matches nothing when no names are configured', () => {
    expect(isDocsHost('docs.example.test', [])).toBe(false)
  })
})

describe('DOCS_SITE_PATH', () => {
  it('is the docs package build output, beside the server package', () => {
    expect(DOCS_SITE_PATH.endsWith(path.join('packages', 'docs', 'dist'))).toBe(true)
  })
})

describe('docsCacheHeaders', () => {
  const root = path.join(path.sep, 'site')
  const headerFor = (relative: string): string | undefined => {
    const headers: Record<string, string> = {}
    docsCacheHeaders(root)(
      { setHeader: (name: string, value: string) => (headers[name] = value) } as never,
      path.join(root, relative),
    )
    return headers['Cache-Control']
  }

  it('keeps hashed build output for a year', () => {
    expect(headerFor('_astro/index.4f9a1c.js')).toBe('public, max-age=31536000, immutable')
  })

  it('keeps hashed Storybook assets for a year, but not the unhashed files beside them', () => {
    expect(headerFor('storybook/assets/iframe-C4EVFBc_.js')).toBe('public, max-age=31536000, immutable')
    expect(headerFor('storybook/index.json')).toBeUndefined()
    expect(headerFor('storybook/sb-manager/runtime.js')).toBeUndefined()
  })

  it('asks about every page again, at any depth', () => {
    expect(headerFor('index.html')).toBe('no-cache')
    expect(headerFor('reference/operations/image/index.html')).toBe('no-cache')
    expect(headerFor('404.html')).toBe('no-cache')
    expect(headerFor('storybook/index.html')).toBe('no-cache')
    expect(headerFor('storybook/iframe.html')).toBe('no-cache')
  })

  it('leaves every other file on the default policy', () => {
    expect(headerFor('favicon.png')).toBeUndefined()
    expect(headerFor('skills/api-reference.md')).toBeUndefined()
    expect(headerFor('pagefind/pagefind.js')).toBeUndefined()
  })
})

describe('createDocsSiteHandler', () => {
  let root: string
  let server: Server
  let origin: string

  const startServer = async (siteRoot: string, hostnames: string[]) => {
    const app = express()
    app.use(createDocsSiteHandler({ hostnames, root: siteRoot }))
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' })
    })
    app.post('/api/thing', (_req, res) => {
      res.json({ from: 'application' })
    })
    app.use(
      (
        error: Error & { status?: number },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(error.status ?? 500).json({ error: 'from error handler' })
      },
    )
    const listening = await new Promise<Server>((resolve) => {
      const started = app.listen(0, () => resolve(started))
    })
    return { listening, address: `http://127.0.0.1:${(listening.address() as AddressInfo).port}` }
  }

  const get = (urlPath: string, host: string, method = 'GET') => requestWithHost(origin, urlPath, host, method)

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'docs-site-'))
    mkdirSync(path.join(root, '_astro'))
    mkdirSync(path.join(root, 'guide'))
    mkdirSync(path.join(root, 'storybook', 'assets'), { recursive: true })
    writeFileSync(path.join(root, 'storybook', 'index.html'), '<html>storybook manager</html>')
    writeFileSync(path.join(root, 'storybook', 'iframe.html'), '<html>storybook canvas</html>')
    writeFileSync(path.join(root, 'storybook', 'assets', 'iframe-C4EVFBc_.js'), 'export {}')
    writeFileSync(path.join(root, 'index.html'), '<html>docs home</html>')
    writeFileSync(path.join(root, 'guide', 'index.html'), '<html>guide</html>')
    symlinkSync('loop', path.join(root, 'loop'))
    writeFileSync(path.join(root, '404.html'), '<html>site not found page</html>')
    writeFileSync(path.join(root, '_astro', 'index.4f9a1c.js'), 'export {}')
    const started = await startServer(root, ['docs.example.test', 'docs-staging.example.test'])
    server = started.listening
    origin = started.address
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  })

  it('serves the home page on a docs host, revalidated every visit', async () => {
    const response = await get('/', 'docs.example.test')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<html>docs home</html>')
    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  it('does not put the image security headers on the site or on the application beside it', async () => {
    // The image policy is `sandbox` with no scripts: it would break the site's pages if it leaked.
    const responses = [
      await get('/', 'docs.example.test'),
      await get('/_astro/index.4f9a1c.js', 'docs.example.test'),
      await get('/nothing-here', 'docs.example.test'),
      await get('/api/thing', 'gib.example.test', 'POST'),
    ]
    for (const response of responses) {
      for (const name of Object.keys(IMAGE_SECURITY_HEADERS)) expect(response.headers.get(name)).toBeNull()
    }
  })

  it('serves on every configured host, and ignores a port in the Host header', async () => {
    expect((await get('/guide/', 'docs-staging.example.test')).status).toBe(200)
    expect((await get('/', 'docs.example.test:8080')).status).toBe(200)
  })

  it('keeps hashed assets for a year', async () => {
    const response = await get('/_astro/index.4f9a1c.js', 'docs.example.test')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('serves Storybook at /storybook/, from its index, and its canvas page, revalidated every visit', async () => {
    for (const [urlPath, body] of [
      ['/storybook/', '<html>storybook manager</html>'],
      ['/storybook/index.html', '<html>storybook manager</html>'],
      ['/storybook/iframe.html?id=components-image--default', '<html>storybook canvas</html>'],
    ]) {
      const response = await get(urlPath, 'docs.example.test')
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(body)
      expect(response.headers.get('cache-control')).toBe('no-cache')
    }
  })

  it('sends /storybook to /storybook/ so its relative links resolve', async () => {
    const response = await get('/storybook', 'docs.example.test')
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('/storybook/')
  })

  it('keeps hashed Storybook assets for a year', async () => {
    const response = await get('/storybook/assets/iframe-C4EVFBc_.js', 'docs.example.test')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('answers a miss with the site’s own 404 page', async () => {
    const response = await get('/nothing-here', 'docs.example.test')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(await response.text()).toBe('<html>site not found page</html>')
  })

  it('does not let an API route answer on a docs host', async () => {
    const response = await get('/api/thing', 'docs.example.test', 'POST')
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('<html>site not found page</html>')
  })

  it('does not serve the site on any other host', async () => {
    const home = await get('/', 'gib.example.test')
    expect(home.status).toBe(404)
    expect(await home.text()).not.toContain('docs home')
    expect((await get('/guide/', 'gib.example.test')).status).toBe(404)
  })

  it('lets the application answer on any other host', async () => {
    const response = await get('/api/thing', 'gib.example.test', 'POST')
    expect(await response.json()).toEqual({ from: 'application' })
  })

  it('passes a request error to the error handler', async () => {
    // A link that points at itself cannot be read; the static handler reports that as a server error
    // rather than a miss, and the handler must not hide it behind a 404 page.
    const response = await get('/loop', 'docs.example.test')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'from error handler' })
  })

  it('answers a short text when the site has not been built', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'docs-site-empty-'))
    const started = await startServer(empty, ['docs.example.test'])
    try {
      const response = await requestWithHost(started.address, '/anything', 'docs.example.test')
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('text/plain')
      expect(await response.text()).toBe('Not found')
    } finally {
      await new Promise((resolve) => started.listening.close(resolve))
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('is off when no host names are configured', async () => {
    const started = await startServer(root, [])
    try {
      const response = await requestWithHost(started.address, '/', 'docs.example.test')
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain('docs home')
    } finally {
      await new Promise((resolve) => started.listening.close(resolve))
    }
  })
})
