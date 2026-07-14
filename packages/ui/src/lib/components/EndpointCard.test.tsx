import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react'

// Mock child components to isolate EndpointCard behavior
vi.mock('./CodeBlock', () => ({ default: ({ code }: { code: string }) => <pre data-testid="code">{code}</pre> }))
vi.mock('./Image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img data-testid="image" src={src} alt={alt} />,
}))

import EndpointCard from './EndpointCard'

// ---------------------------------------------------------------------------
// Global fetch mock — the network boundary the live "try it" panel calls.
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

/**
 * Build a Headers-like object the component can read via `.get(name)`.
 * The component only ever calls headers.get('content-type'),
 * 'cf-cache-status' and 'x-cache' (the latter two via isCacheHit).
 */
function makeHeaders(map: Record<string, string>) {
  return {
    get: (name: string) => map[name.toLowerCase()] ?? null,
  } as unknown as Headers
}

/** A successful JSON response with the shape the component reads. */
function jsonResponse({
  status = 200,
  body = '{"ok":true}',
  contentType = 'application/json',
  cacheStatus,
}: {
  status?: number
  body?: string
  contentType?: string
  cacheStatus?: string
} = {}) {
  const headerMap: Record<string, string> = { 'content-type': contentType }
  if (cacheStatus) headerMap['cf-cache-status'] = cacheStatus
  return {
    ok: status >= 200 && status < 400,
    status,
    statusText: 'OK',
    headers: makeHeaders(headerMap),
    text: () => Promise.resolve(body),
    blob: () => Promise.resolve({ size: body.length }),
  }
}

/** An error response (!ok) — the component throws `${status} ${statusText}`. */
function errorResponse({ status = 500, statusText = 'Internal Server Error' } = {}) {
  return {
    ok: false,
    status,
    statusText,
    headers: makeHeaders({ 'content-type': 'application/json' }),
    text: () => Promise.resolve('{}'),
    blob: () => Promise.resolve({ size: 0 }),
  }
}

/**
 * Render the card and expand the disclosure so the live ResponsePanel mounts.
 * The panel only exists when an `example` is provided and the disclosure is open.
 */
function renderExpanded(example = 'https://api.example.com/v1/tokens') {
  render(
    <EndpointCard method="GET" path="/v1/tokens" description="List tokens" example={example} />,
  )
  // Headless UI DisclosurePanel is unmounted while closed; click to open it.
  fireEvent.click(screen.getByRole('button'))
  return screen.getByRole('textbox') as HTMLInputElement
}

describe('EndpointCard', () => {
  beforeEach(() => {
    // Auto-cleanup is not registered (no globals/setup file), so unmount
    // any DOM left over from a previous test before each run.
    cleanup()
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  // -------------------------------------------------------------------------
  // Existing static-rendering tests (preserved)
  // -------------------------------------------------------------------------
  it('renders path with parameter highlighting', () => {
    render(<EndpointCard method="GET" path="/image/{chainId}/{address}" description="Get token image" />)

    // Verify parsePathParams was wired correctly — params should be in accent color spans
    const text = screen.getByText('{chainId}')
    expect(text).toBeDefined()
    expect(text.className).toContain('accent')
  })

  it('renders static path segments without accent', () => {
    render(<EndpointCard method="GET" path="/stats" description="Get stats" />)

    const text = screen.getByText('/stats')
    expect(text).toBeDefined()
    expect(text.className).not.toContain('accent')
  })

  it('displays method badge', () => {
    render(<EndpointCard method="POST" path="/submit" description="Submit" />)

    expect(screen.getByText('POST')).toBeDefined()
  })

  it('displays description', () => {
    render(<EndpointCard method="GET" path="/stats" description="Server statistics" />)

    expect(screen.getByText('Server statistics')).toBeDefined()
  })

  // -------------------------------------------------------------------------
  // Without example: no expandable panel, just static info
  // -------------------------------------------------------------------------
  it('does not render an expandable disclosure (or fetch) when no example is given', () => {
    render(<EndpointCard method="GET" path="/stats" description="Server statistics" />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // The URL input
  // -------------------------------------------------------------------------
  it('seeds the URL input from the example prop', () => {
    mockFetch.mockResolvedValue(jsonResponse())
    const input = renderExpanded('https://api.example.com/seed')

    expect(input.value).toBe('https://api.example.com/seed')
  })

  it('fetches the example URL when the panel is opened', async () => {
    mockFetch.mockResolvedValue(jsonResponse())
    renderExpanded('https://api.example.com/v1/tokens')

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/tokens',
      expect.objectContaining({ signal: expect.any(Object) }),
    )
  })

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  it('shows a loading indicator while the fetch is in flight', async () => {
    // A fetch that never resolves keeps the panel in its loading state.
    mockFetch.mockReturnValue(new Promise(() => {}))
    renderExpanded()

    // "Fetching..." (stats column) and "Loading response..." (body column)
    await waitFor(() => expect(screen.getByText(/Fetching/)).toBeDefined())
    expect(screen.getByText(/Loading response/)).toBeDefined()
    // No response rendered yet
    expect(screen.queryByTestId('code')).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Success state — JSON body + stats
  // -------------------------------------------------------------------------
  it('renders the JSON response body and stats on success', async () => {
    const body = JSON.stringify({ total: 42, tokens: [{ a: 1 }, { b: 2 }] })
    mockFetch.mockResolvedValue(
      jsonResponse({ status: 200, body, contentType: 'application/json; charset=utf-8' }),
    )
    renderExpanded()

    // The mocked CodeBlock renders the pretty-printed JSON into <pre data-testid="code">
    const code = await screen.findByTestId('code')
    const parsed = JSON.parse(code.textContent ?? '')
    expect(parsed).toEqual({ total: 42, tokens: [{ a: 1 }, { b: 2 }] })

    // Stats column: status, time, size, cache MISS, content type, result count
    expect(screen.getByText('Status')).toBeDefined()
    expect(screen.getByText('200')).toBeDefined()
    expect(screen.getByText(/ms$/)).toBeDefined() // duration row
    expect(screen.getByText('MISS')).toBeDefined()
    // content-type is split on ';' — charset suffix dropped
    expect(screen.getByText('application/json')).toBeDefined()
    // countResults reads `total` first → 42
    expect(screen.getByText('42')).toBeDefined()
    // loading indicators gone
    expect(screen.queryByText(/Fetching/)).toBeNull()
  })

  it('reports a cache HIT when the cf-cache-status header says HIT', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ body: '{"ok":true}', cacheStatus: 'HIT' }))
    renderExpanded()

    await screen.findByTestId('code')
    expect(screen.getByText('HIT')).toBeDefined()
  })

  // -------------------------------------------------------------------------
  // Error state — !ok response
  // -------------------------------------------------------------------------
  it('renders an error message when the response is not ok', async () => {
    mockFetch.mockResolvedValue(errorResponse({ status: 500, statusText: 'Internal Server Error' }))
    renderExpanded()

    // The thrown message is `${status} ${statusText}` and is shown in red.
    const errors = await screen.findAllByText('500 Internal Server Error')
    expect(errors.length).toBeGreaterThan(0)
    // No JSON body rendered on failure
    expect(screen.queryByTestId('code')).toBeNull()
  })

  it('renders an error message when fetch rejects (network failure)', async () => {
    mockFetch.mockRejectedValue(new Error('Network down'))
    renderExpanded()

    const errors = await screen.findAllByText('Network down')
    expect(errors.length).toBeGreaterThan(0)
    expect(screen.queryByTestId('code')).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Image endpoints — render preview, skip JSON parse
  // -------------------------------------------------------------------------
  it('renders an image preview (not JSON) for image endpoints', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ contentType: 'image/png', body: 'binarybytes' }),
    )
    render(
      <EndpointCard
        method="GET"
        path="/image/{chainId}/{address}"
        description="Token image"
        example="https://api.example.com/image/1/0xabc"
      />,
    )
    fireEvent.click(screen.getByRole('button'))

    // Mocked Image component renders an <img data-testid="image">
    const img = await screen.findByTestId('image')
    expect(img.getAttribute('src')).toBe('https://api.example.com/image/1/0xabc')
    // JSON code block must NOT be rendered for image endpoints
    expect(screen.queryByTestId('code')).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Editing the URL re-triggers the fetch
  // -------------------------------------------------------------------------
  it('re-fetches with the new URL when the input value changes', async () => {
    mockFetch.mockResolvedValue(jsonResponse())
    const input = renderExpanded('https://api.example.com/first')

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/first', expect.anything()))

    fireEvent.change(input, { target: { value: 'https://api.example.com/second' } })
    expect(input.value).toBe('https://api.example.com/second')

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/second', expect.anything()),
    )
  })

  // -------------------------------------------------------------------------
  // Enter-to-run: handleKeyDown blurs the input on Enter without throwing
  // -------------------------------------------------------------------------
  it('blurs the input on Enter without throwing', async () => {
    mockFetch.mockResolvedValue(jsonResponse())
    const input = renderExpanded()
    input.focus()
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'Enter' })

    // handleKeyDown calls blur() — focus leaves the input.
    expect(document.activeElement).not.toBe(input)
  })

  it('does not blur on a non-Enter key', async () => {
    mockFetch.mockResolvedValue(jsonResponse())
    const input = renderExpanded()
    input.focus()

    fireEvent.keyDown(input, { key: 'a' })

    expect(document.activeElement).toBe(input)
  })

  // -------------------------------------------------------------------------
  // AbortController: unmounting mid-flight must not throw or set state late.
  // -------------------------------------------------------------------------
  it('aborts the in-flight fetch on unmount without throwing or warning', async () => {
    let abortedSignal: AbortSignal | null = null
    // Resolve only after we have unmounted, so the .then() runs post-unmount.
    let resolveFetch: ((value: unknown) => void) | null = null
    mockFetch.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      abortedSignal = init.signal
      return new Promise((resolve) => {
        resolveFetch = resolve
      })
    })

    render(
      <EndpointCard method="GET" path="/v1/tokens" description="List" example="https://api.example.com/v1/tokens" />,
    )
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(abortedSignal!.aborted).toBe(false)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Unmount mid-flight — the effect cleanup should abort the controller.
    cleanup()
    expect(abortedSignal!.aborted).toBe(true)

    // Now let the pending fetch resolve; the aborted-signal guards must
    // prevent any setState on the unmounted component (no act() warning).
    await act(async () => {
      resolveFetch!(jsonResponse())
      await Promise.resolve()
    })

    const actWarnings = errorSpy.mock.calls.filter((c) => String(c[0]).includes('not wrapped in act'))
    expect(actWarnings).toHaveLength(0)
    errorSpy.mockRestore()
  })

  it('aborts the previous fetch when the URL changes', async () => {
    const signals: AbortSignal[] = []
    mockFetch.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal)
      return new Promise(() => {}) // never resolves; keep both in flight
    })

    const input = renderExpanded('https://api.example.com/first')
    await waitFor(() => expect(signals.length).toBe(1))
    expect(signals[0]!.aborted).toBe(false)

    fireEvent.change(input, { target: { value: 'https://api.example.com/second' } })

    await waitFor(() => expect(signals.length).toBe(2))
    // The first request's signal must be aborted once the URL changed.
    expect(signals[0]!.aborted).toBe(true)
    expect(signals[1]!.aborted).toBe(false)
  })
})
