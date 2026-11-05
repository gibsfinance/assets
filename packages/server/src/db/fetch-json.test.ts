import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('../fetch', () => ({ fetch: fetchMock }))

import { fetchJSON, redactUrl } from './fetch-json'

const answer = (body: string, init: ResponseInit = {}) => fetchMock.mockResolvedValue(new Response(body, init))

beforeEach(() => fetchMock.mockReset())

describe('redactUrl', () => {
  it('removes credentials and secret-looking query values but keeps the rest', () => {
    const shown = redactUrl('https://user:pw@example.com/list.json?apikey=abc&api_token=def&chain=1')
    expect(shown).toBe('https://example.com/list.json?apikey=redacted&api_token=redacted&chain=1')
  })

  it('reads the address out of a URL object', () => {
    expect(redactUrl(new URL('https://example.com/a?secret=1'))).toBe('https://example.com/a?secret=redacted')
  })

  it('does not echo back an address that does not parse', () => {
    expect(redactUrl('not a url?key=abc')).toBe('<unparseable url>')
  })
})

describe('fetchJSON', () => {
  it('returns the parsed body and forwards the request options', async () => {
    answer('{"a":1}')
    await expect(fetchJSON('https://example.com/x', { method: 'GET' })).resolves.toEqual({ a: 1 })
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/x', { method: 'GET' })
  })

  it('names the address, status, content type and body when the answer is a refusal', async () => {
    answer('404: Not Found', { status: 404, headers: { 'content-type': 'text/plain' } })
    await expect(fetchJSON('https://example.com/gone.json?key=s3cret')).rejects.toThrow(
      'https://example.com/gone.json?key=redacted answered 404 (content-type: text/plain): 404: Not Found',
    )
  })

  it('reports an HTML page that came back with a success status, keeping the parse error as cause', async () => {
    answer('<!DOCTYPE html>\n<html>\n  gateway moved', { headers: { 'content-type': 'text/html' } })
    const error = (await fetchJSON('https://example.com/x').catch((err: Error) => err)) as Error
    expect(error.message).toBe(
      'https://example.com/x answered 200 (content-type: text/html) with a body that is not JSON: <!DOCTYPE html> <html> gateway moved',
    )
    expect((error.cause as Error).message).toMatch(/not valid JSON/)
  })

  it('says so when the answer carries no content type, and cuts a long body short', async () => {
    const response = new Response(null, { status: 500 })
    vi.spyOn(response, 'text').mockResolvedValue('x'.repeat(500))
    vi.spyOn(response.headers, 'get').mockReturnValue(null)
    fetchMock.mockResolvedValue(response)
    const error = (await fetchJSON('https://example.com/x').catch((err: Error) => err)) as Error
    expect(error.message).toContain('(content-type: none)')
    expect(error.message.endsWith(`: ${'x'.repeat(120)}`)).toBe(true)
  })
})
