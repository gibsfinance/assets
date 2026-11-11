import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlobStoreError, expectStatus, parseModifiedAt, readBytes, RETRY_BASE_DELAY_MS, sendWithRetry } from './http'

const logMock = vi.hoisted(() => vi.fn())
vi.mock('../logger', () => ({ log: logMock }))

afterEach(() => {
  vi.useRealTimers()
})

describe('sendWithRetry', () => {
  it('returns the first answer that is not throttled or failed, without waiting', async () => {
    const sleep = vi.fn()
    const send = vi.fn(async () => new Response('ok', { status: 404 }))

    const response = await sendWithRetry(send, { sleep })

    expect(response.status).toBe(404)
    expect(send).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('asks again after a 429 and a 503, waiting twice as long each time', async () => {
    const sleep = vi.fn(async () => undefined)
    const statuses = [429, 503, 200]
    const send = vi.fn(async () => new Response('', { status: statuses.shift() }))

    const response = await sendWithRetry(send, { sleep })

    expect(response.status).toBe(200)
    expect(sleep.mock.calls).toEqual([[RETRY_BASE_DELAY_MS], [RETRY_BASE_DELAY_MS * 2]])
  })

  it('asks again after a network failure', async () => {
    const sleep = vi.fn(async () => undefined)
    const send = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(new Response('', { status: 200 }))

    expect((await sendWithRetry(send, { sleep })).status).toBe(200)
    expect(logMock).toHaveBeenCalled()
  })

  it('hands back the last answer once retries run out', async () => {
    const send = vi.fn(async () => new Response('', { status: 500 }))

    const response = await sendWithRetry(send, { retries: 1, sleep: async () => undefined })

    expect(response.status).toBe(500)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('throws the last network error once retries run out', async () => {
    const send = vi.fn(async () => {
      throw new Error('unreachable')
    })

    await expect(sendWithRetry(send, { retries: 1, sleep: async () => undefined })).rejects.toThrow('unreachable')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('waits on a real timer when no sleep is given', async () => {
    vi.useFakeTimers()
    const statuses = [503, 200]
    const send = vi.fn(async () => new Response('', { status: statuses.shift() }))

    const pending = sendWithRetry(send)
    await vi.advanceTimersByTimeAsync(RETRY_BASE_DELAY_MS)

    expect((await pending).status).toBe(200)
  })
})

describe('expectStatus', () => {
  it('passes an answer with an accepted status through', async () => {
    const response = new Response(null, { status: 204 })

    expect(await expectStatus(response, 'op', [200, 204])).toBe(response)
  })

  it('accepts 200 by default', async () => {
    expect((await expectStatus(new Response('', { status: 200 }), 'op')).status).toBe(200)
  })

  it('throws with the operation, the status and the start of the body', async () => {
    const error = await expectStatus(new Response('denied', { status: 403 }), 's3 put').catch((thrown) => thrown)

    expect(error).toBeInstanceOf(BlobStoreError)
    expect(error.status).toBe(403)
    expect(error.message).toBe('s3 put failed with status 403: denied')
  })

  it('leaves the detail out when the body is empty or unreadable', async () => {
    const unreadable = new Response('x', { status: 500 })
    vi.spyOn(unreadable, 'text').mockRejectedValue(new Error('stream broke'))

    await expect(expectStatus(new Response('', { status: 500 }), 'op')).rejects.toThrow(/^op failed with status 500$/)
    await expect(expectStatus(unreadable, 'op')).rejects.toThrow(/^op failed with status 500$/)
  })
})

describe('readBytes', () => {
  it('returns the body as a buffer', async () => {
    expect(await readBytes(new Response(Buffer.from([1, 2, 3])))).toEqual(Buffer.from([1, 2, 3]))
  })
})

describe('parseModifiedAt', () => {
  it('reads an HTTP date and an ISO timestamp', () => {
    expect(parseModifiedAt('Wed, 11 Nov 2026 12:00:00 GMT', 'op')).toBe(Date.UTC(2026, 10, 11, 12))
    expect(parseModifiedAt('2026-11-11T12:00:00.000Z', 'op')).toBe(Date.UTC(2026, 10, 11, 12))
  })

  it.each([null, undefined, '', 'yesterday'])('refuses %j, so gc never has to guess an age', (text) => {
    expect(() => parseModifiedAt(text, 'op')).toThrow(BlobStoreError)
  })
})
