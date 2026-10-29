/**
 * The entry script mounts over markup the build already wrote into `#app`.
 *
 * The page paints from that markup before any script runs. The client must then
 * replace it without complaint: a hydration error here would show as a console
 * error in every visitor's browser while the page still looked fine. This mounts the
 * real entry over the real build-time markup and asserts it neither throws nor
 * leaves the static copy behind next to the live one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { renderHome } from './entry-server'

/** Every root the entry script creates, so each test can unmount what it mounted. */
const mountedRoots = vi.hoisted(() => [] as Array<{ unmount: () => void }>)

vi.mock('react-dom/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-dom/client')>()
  return {
    ...original,
    createRoot: (...args: Parameters<typeof original.createRoot>) => {
      const root = original.createRoot(...args)
      mountedRoots.push(root)
      return root
    },
  }
})

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  vi.stubGlobal('ResizeObserver', NoopObserver)
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  )
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) }))
})

afterEach(() => {
  mountedRoots.splice(0).forEach((root) => act(() => root.unmount()))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('entry script over the static home markup', () => {
  it('replaces the markup with the live page without throwing or logging an error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    document.body.innerHTML = `<div id="app">${renderHome()}</div>`
    expect(document.querySelectorAll('h1')).toHaveLength(1)

    await expect(import('./main')).resolves.toBeDefined()

    await waitFor(() => expect(document.querySelector('#app header')).not.toBeNull())
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(errors).not.toHaveBeenCalled()
  })
})
