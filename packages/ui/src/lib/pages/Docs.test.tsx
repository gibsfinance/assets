/**
 * The public documentation page.
 *
 * The page owns no endpoint data of its own: it fetches the served OpenAPI definition and
 * renders one section per tag and one card per operation. Only the feature grid and the
 * hand-written code samples are literal content in this file. That split is what these
 * tests are built around, because the page's real failures are all silences:
 *
 * - a tag that reaches the definition but no operation, so its whole section vanishes
 *   from the page and from the table of contents with nothing to see;
 * - an operation with no tag, which renders nowhere while still being a live endpoint;
 * - a table-of-contents entry whose anchor no section uses, which looks fine and does
 *   nothing when clicked;
 * - a hand-written code sample drifting away from the definition — a path the server
 *   does not serve, or a query parameter it does not accept — which nobody notices until
 *   a reader copies it.
 *
 * The definition imported here is the one the server actually serves, so these
 * cross-checks keep working as endpoints are added rather than freezing today's copy.
 * Nothing in the application is mocked: the network, `matchMedia`, `IntersectionObserver`
 * and `scrollIntoView` are stubbed at the host boundary, and the real code-sample
 * highlighter and endpoint cards render.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The base the page builds every sample address from is read from the environment when
// `config` is first imported, so it has to be set before the imports below run.
const { API_BASE, previousPublicBase } = vi.hoisted(() => {
  const base = 'https://gib.show'
  const previous = process.env.PUBLIC_BASE_URL
  process.env.PUBLIC_BASE_URL = base
  return { API_BASE: base, previousPublicBase: previous }
})

import Docs from './Docs'
import { getApiUrl } from '../utils'
import { openapi } from '../../../../server/src/server/openapi'

// The environment is shared with every other test file in this worker, so hand it back
// exactly as it was found — including having been unset.
afterAll(() => {
  if (previousPublicBase === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = previousPublicBase
})

// ---------------------------------------------------------------------------
// The served definition, read structurally. The page's own types describe only
// the fields it renders; these tests also read the declared parameters, which
// is what makes the sample cross-check meaningful.
// ---------------------------------------------------------------------------

interface SpecParameter {
  name: string
  in: string
  schema?: { enum?: readonly string[] }
}

interface SpecOperation {
  tags?: readonly string[]
  summary?: string
  parameters?: readonly SpecParameter[]
}

interface ServedSpec {
  tags: readonly { name: string; description?: string }[]
  paths: Readonly<Record<string, Readonly<Record<string, SpecOperation>>>>
}

const spec = openapi as unknown as ServedSpec

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

/** Every operation the definition declares, as method-and-path pairs. */
const documentedOperations = Object.entries(spec.paths).flatMap(([path, methods]) =>
  HTTP_METHODS.filter((method) => methods[method]).map((method) => ({
    method: method.toUpperCase(),
    path,
    operation: methods[method],
  })),
)

// ---------------------------------------------------------------------------
// Host boundary stubs
// ---------------------------------------------------------------------------

/** Observers created by the page, keyed by the element each one watches. */
let observers: { element: Element; callback: (entries: { isIntersecting: boolean }[]) => void }[] = []

function stubIntersectionObserver() {
  class RecordingObserver {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe(element: Element) {
      observers.push({ element, callback: this.callback })
    }
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', RecordingObserver)
}

/** Reports the section a given observer watches as having scrolled into view. */
function scrollSectionIntoView(id: string) {
  const observer = observers.find((entry) => (entry.element as HTMLElement).id === id)
  expect(observer, `no observer was attached to the ${id} section`).toBeTruthy()
  act(() => observer!.callback([{ isIntersecting: true }]))
}

let scrolledInto: Element[] = []
const originalScrollIntoView = Element.prototype.scrollIntoView

const mockFetch = vi.fn()

/** Answer the definition request with the document the server serves. */
function serveDefinition() {
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => spec })
}

beforeEach(() => {
  observers = []
  scrolledInto = []
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  stubIntersectionObserver()
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  )
  Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) {
    scrolledInto.push(this)
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Element.prototype.scrollIntoView = originalScrollIntoView
})

function renderDocs() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Docs />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Render and wait until the fetched definition has been turned into sections. */
async function renderLoadedDocs() {
  serveDefinition()
  const view = renderDocs()
  await waitFor(() => expect(sectionElements(view.container).length).toBeGreaterThan(2))
  return view
}

const sectionElements = (container: HTMLElement) => [...container.querySelectorAll('main section[id]')] as HTMLElement[]

/** The wide-screen table of contents; the narrow one repeats the same labels. */
const navButtons = (container: HTMLElement) =>
  [...container.querySelectorAll('aside nav button')] as HTMLButtonElement[]

/** The narrow tab strip, which is the only variant that marks the current section. */
const activeTabLabel = (container: HTMLElement) =>
  container.querySelector('button[data-active="true"]')?.textContent?.trim()

// ---------------------------------------------------------------------------
// Sample-address checking against the definition
// ---------------------------------------------------------------------------

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** '/image/{chainId}/{address}' → a pattern matching one concrete request path. */
function pathTemplateToPattern(template: string): RegExp {
  const placeholder = '\u0000'
  const escaped = escapeForRegExp(template.replace(/\{[^}]+\}/g, placeholder))
  return new RegExp(`^${escaped.split(placeholder).join('[^/]+')}$`)
}

const documentedPaths = Object.entries(spec.paths).map(([path, methods]) => ({
  path,
  pattern: pathTemplateToPattern(path),
  queryParameters: new Map(
    HTTP_METHODS.flatMap((method) => methods[method]?.parameters ?? [])
      .filter((parameter) => parameter.in === 'query')
      .map((parameter) => [parameter.name, parameter.schema?.enum] as const),
  ),
}))

/** Output formats the path-extension route accepts, straight from the definition. */
const documentedExtensions =
  spec.paths['/image/{chainId}/{address}.{ext}'].get?.parameters?.find((parameter) => parameter.name === 'ext')?.schema
    ?.enum ?? []

/** Pull every concrete sample address out of rendered sample text. */
function sampleAddressesIn(text: string): string[] {
  const pattern = new RegExp(`${escapeForRegExp(API_BASE)}(?:/[^\\s"'\`)<>]*)`, 'g')
  return text.match(pattern) ?? []
}

/** Collect the samples from every language tab, since only one renders at a time. */
function collectSampleAddresses(container: HTMLElement): string[] {
  const collected: string[] = []
  const tabs = [...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
  for (const tab of tabs) {
    fireEvent.click(tab)
    collected.push(...sampleAddressesIn(container.querySelector('#code-examples')?.textContent ?? ''))
  }
  return collected
}

describe('Docs', () => {
  it('says it is waiting while the definition is still in flight', () => {
    mockFetch.mockReturnValue(new Promise(() => {}))
    const { container } = renderDocs()

    expect(container.textContent).toContain('Loading the API definition')
    // Only the two hand-written sections exist before the definition arrives, so a
    // reader is never shown an empty endpoint reference as if that were the whole page.
    expect(sectionElements(container).map((section) => section.id)).toEqual(['features', 'code-examples'])
  })

  it('names the failure and offers the raw definition when the fetch is rejected', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const { container } = renderDocs()

    await waitFor(() => expect(container.textContent).toContain('Could not load the API definition'))
    // The status is the one diagnostic a reader can act on, and the escape hatch has to
    // point at the same document the page failed to read.
    expect(container.textContent).toContain('503')
    const escapeHatch = [...container.querySelectorAll('a')].find(
      (anchor) => anchor.textContent?.trim() === '/openapi.json',
    )
    expect(escapeHatch?.getAttribute('href')).toBe(getApiUrl('/openapi.json'))
  })

  it('lists every rendered section in the table of contents, and nothing else', async () => {
    // Both directions matter and both fail silently. A section with no entry is
    // unreachable except by scrolling; an entry with no section is a dead link.
    const { container } = await renderLoadedDocs()
    const headings = sectionElements(container).map((section) => section.querySelector('h2')?.textContent?.trim())

    expect(navButtons(container).map((button) => button.textContent?.trim())).toEqual(headings)
  })

  it('gives every table-of-contents entry a section it can actually scroll to', async () => {
    const { container } = await renderLoadedDocs()
    const buttons = navButtons(container)
    expect(buttons.length).toBeGreaterThan(2)

    for (const button of buttons) {
      scrolledInto = []
      fireEvent.click(button)
      // The narrow tab strip also scrolls its own active tab along, so only the page
      // sections are of interest here.
      const sections = scrolledInto.filter((element) => element.tagName === 'SECTION')
      expect(sections, `${button.textContent} scrolled no section into view`).toHaveLength(1)
      const target = sections[0] as HTMLElement
      expect(target.querySelector('h2')?.textContent?.trim()).toBe(button.textContent?.trim())
    }
  })

  it('opens with a section that is on the page highlighted', async () => {
    // The opening highlight is a literal in the page, not derived from the definition,
    // so renaming or reordering the first tag leaves it pointing at nothing.
    const { container } = await renderLoadedDocs()
    const label = activeTabLabel(container)

    expect(label).toBeTruthy()
    const headings = sectionElements(container).map((section) => section.querySelector('h2')?.textContent?.trim())
    expect(headings).toContain(label)
  })

  it('moves the highlight to whichever section scrolls into view', async () => {
    const { container } = await renderLoadedDocs()
    scrollSectionIntoView('features')
    expect(activeTabLabel(container)).toBe('Features')

    scrollSectionIntoView('code-examples')
    expect(activeTabLabel(container)).toBe('Code Examples')
  })

  it('renders a section for every tag the served definition declares', async () => {
    // A tag whose operations all lost it is dropped without a trace: no heading, no
    // entry, no error. This is the check that notices.
    const { container } = await renderLoadedDocs()
    const headings = sectionElements(container).map((section) => section.querySelector('h2')?.textContent?.trim())

    for (const tag of spec.tags) {
      expect(headings, `the ${tag.name} section is missing from the page`).toContain(tag.name)
    }
  })

  it('renders a card for every operation the served definition declares', async () => {
    // An operation with no tag belongs to no section, so it is documented nowhere while
    // still being served. Nothing about the page looks wrong when that happens.
    const { container } = await renderLoadedDocs()
    const cards = [...container.querySelectorAll('main .glass-card')].flatMap((card) =>
      [...card.children].map((child) => child.textContent ?? ''),
    )

    for (const { method, path } of documentedOperations) {
      expect(
        cards.some((text) => text.includes(method) && text.includes(path)),
        `${method} ${path} is documented nowhere on the page`,
      ).toBe(true)
    }
  })

  it('filters cards by path fragment without disturbing the table of contents', async () => {
    const { container } = await renderLoadedDocs()
    const before = navButtons(container).map((button) => button.textContent)

    fireEvent.change(container.querySelector('input[type="search"]')!, {
      target: { value: '/sprite/' },
    })

    const shown = [...container.querySelectorAll('main .glass-card')].flatMap((card) =>
      [...card.children].map((child) => child.textContent ?? ''),
    )
    expect(shown.some((text) => text.includes('/sprite/{providerKey}/{listKey}'))).toBe(true)
    expect(shown.some((text) => text.includes('/list/tokens/{chainId}'))).toBe(false)
    // Sections that match nothing keep their heading and their entry, so the page does
    // not reflow under the reader while they type.
    expect(navButtons(container).map((button) => button.textContent)).toEqual(before)
    expect(container.textContent).toContain('No endpoints match')
  })

  it('filters cards by their description as well as their path', async () => {
    // Readers search for what an endpoint does far more often than for its path, and the
    // description half of that comparison is easy to drop without noticing.
    const { container } = await renderLoadedDocs()
    fireEvent.change(container.querySelector('input[type="search"]')!, {
      target: { value: 'sprite sheet' },
    })

    const shown = [...container.querySelectorAll('main .glass-card')].flatMap((card) =>
      [...card.children].map((child) => child.textContent ?? ''),
    )
    expect(shown.some((text) => text.includes('/sprite/{providerKey}/{listKey}'))).toBe(true)
    expect(shown.some((text) => text.includes('/health'))).toBe(false)
  })

  it('treats a blank filter as no filter', async () => {
    const { container } = await renderLoadedDocs()
    const search = container.querySelector('input[type="search"]')!
    fireEvent.change(search, { target: { value: '/health' } })
    expect(container.textContent).toContain('No endpoints match')

    fireEvent.change(search, { target: { value: '   ' } })
    expect(container.textContent).not.toContain('No endpoints match')
  })

  // Coverage instrumentation adds enough per-statement overhead to a full render plus
  // waitFor cycle that this test edges past the default 5s budget under `--coverage`
  // once the file's total worker time grows — see the vitest-coverage-timeout-pressure
  // skill. Isolated runs finish in ~1.3s; this raises only this test's budget.
  it('only shows sample requests the served definition actually documents', { timeout: 15_000 }, async () => {
    // The samples are written by hand and the endpoints move underneath them. A sample
    // pointing at a path the server no longer serves fails only for the reader who
    // copies it.
    const { container } = await renderLoadedDocs()
    const samples = collectSampleAddresses(container)
    expect(samples.length).toBeGreaterThan(5)

    for (const sample of samples) {
      const [path] = sample.slice(API_BASE.length).split('?')
      expect(
        documentedPaths.some((documented) => documented.pattern.test(path)),
        `the sample request ${path} matches no documented endpoint`,
      ).toBe(true)
    }
  })

  it('only uses query parameters, and query values, the matching endpoint declares', async () => {
    const { container } = await renderLoadedDocs()
    const samples = collectSampleAddresses(container)
    const checked: string[] = []

    for (const sample of samples) {
      const [path, query] = sample.slice(API_BASE.length).split('?')
      if (!query) continue
      const matching = documentedPaths.filter((documented) => documented.pattern.test(path))
      for (const [key, value] of new URLSearchParams(query)) {
        checked.push(key)
        expect(
          matching.some((documented) => documented.queryParameters.has(key)),
          `the sample request ${path} passes ${key}, which no matching endpoint declares`,
        ).toBe(true)
        // Where the definition fixes the accepted values, a sample outside that set is
        // either ignored by the server or rejected — silently wrong copy either way.
        expect(
          matching.some((documented) => {
            const allowed = documented.queryParameters.get(key)
            return documented.queryParameters.has(key) && (!allowed || allowed.includes(value))
          }),
          `the sample request ${path} passes ${key}=${value}, which the definition does not allow`,
        ).toBe(true)
      }
    }

    // Guard the guard: a sample set that suddenly carries no query parameters at all
    // would let the assertion above pass without ever running.
    expect(checked.length).toBeGreaterThan(3)
  })

  it('writes sample chain identifiers and token addresses in the documented form', async () => {
    // A truncated address or a bare chain number in a sample produces a 404, not an
    // error anyone here would see.
    const { container } = await renderLoadedDocs()
    const samples = collectSampleAddresses(container)
    let addressCount = 0

    for (const sample of samples) {
      const [path] = sample.slice(API_BASE.length).split('?')
      for (const segment of path.split('/')) {
        if (segment.startsWith('0x')) {
          addressCount += 1
          // The path-extension route puts the output format after the address, and that
          // format has to be one the definition lists.
          const [address, extension] = segment.split('.')
          expect(address, `${address} is not a full token address`).toMatch(/^0x[0-9a-fA-F]{40}$/)
          if (extension) {
            expect(
              documentedExtensions,
              `the sample request asks for .${extension}, which is not a documented output format`,
            ).toContain(extension)
          }
        }
        if (segment.startsWith('eip155')) {
          expect(segment, `${segment} is not a prefixed chain identifier`).toMatch(/^eip155-\d+$/)
        }
      }
    }

    expect(addressCount).toBeGreaterThan(0)
  })

  it('swaps the sample when another language is chosen', async () => {
    const { container } = await renderLoadedDocs()
    const samples = container.querySelector('#code-examples') as HTMLElement
    const tab = (label: string) => within(samples).getByRole('tab', { name: label }) as HTMLButtonElement

    fireEvent.click(tab('cURL'))
    expect(tab('cURL').getAttribute('aria-selected')).toBe('true')
    expect(samples.textContent).toContain('curl -o wpls.png')

    fireEvent.click(tab('HTML'))
    expect(tab('HTML').getAttribute('aria-selected')).toBe('true')
    expect(samples.textContent).not.toContain('curl -o wpls.png')
    expect(samples.textContent).toContain('<img src=')
  })

  it('links its header to the definition it renders from', async () => {
    // The page is generated from this document; a header pointing somewhere else would
    // send readers to a different contract than the one below it.
    const { container } = await renderLoadedDocs()
    const link = [...container.querySelectorAll('a')].find((anchor) =>
      anchor.textContent?.includes('OpenAPI definition'),
    )

    expect(link?.getAttribute('href')).toBe(getApiUrl('/openapi.json'))
    expect(link?.getAttribute('rel')).toContain('noopener')
    expect(mockFetch).toHaveBeenCalledWith(getApiUrl('/openapi.json'))
  })

  it('sends readers on to the studio', async () => {
    const { container } = await renderLoadedDocs()
    const link = [...container.querySelectorAll('a')].find((anchor) => anchor.textContent?.includes('Open Studio'))
    expect(link?.getAttribute('href')).toBe('/studio')
  })
})
