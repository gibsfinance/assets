/**
 * CodeOutput picks which generator produces the code a reader copies into
 * their own project, based on the format tab and the snippet/component mode.
 * The generators themselves are exhaustively tested in
 * `utils/snippet-generators.test.ts` — what nothing exercised is CodeOutput's
 * own wiring: does the SDK tab actually call the SDK generator, does the
 * component switch actually change which React generator runs, does the img
 * tab warn about badges it cannot render, and does the copy button copy the
 * text that is actually on screen.
 *
 * Shiki loads asynchronously and CodeBlock falls back to a plain `<pre><code>`
 * until it does — jsdom never resolves the dynamic import in these tests, so
 * every assertion reads that plain-text fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import CodeOutput from './CodeOutput'
import { StudioProvider, useStudio } from '../contexts/StudioContext'
import type { Token } from '../types'

const TOKEN: Token = {
  chainId: 1,
  address: '0xAbCdEf0000000000000000000000000000000001',
  name: 'Test Token',
  symbol: 'TEST',
  decimals: 18,
  hasIcon: true,
  sourceList: 'gib/default',
  chainIdentifier: 'eip155-1',
}

/** Drives context state the toolbar itself does not expose a control for. */
function ContextProbe() {
  const { selectToken, updateBadge } = useStudio()
  return (
    <div>
      <button data-testid="select-token" onClick={() => selectToken(TOKEN)}>
        select token
      </button>
      <button data-testid="enable-badge" onClick={() => updateBadge({ enabled: true })}>
        enable badge
      </button>
    </div>
  )
}

function renderCodeOutput() {
  return render(
    <StudioProvider>
      <CodeOutput />
      <ContextProbe />
    </StudioProvider>,
  )
}

/** The fallback `<pre><code>` CodeBlock renders before Shiki has loaded. */
function codeText(): string {
  return document.querySelector('pre code')?.textContent ?? ''
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(cleanup)

describe('format tabs choose the generator', () => {
  it('defaults to the SDK snippet', () => {
    renderCodeOutput()
    expect(codeText()).toContain(`from '@gibs/react'`)
    expect(codeText()).toContain('<TokenImage')
  })

  it('switches to the React snippet generator', () => {
    renderCodeOutput()
    fireEvent.click(screen.getByRole('button', { name: 'React' }))
    expect(codeText()).not.toContain('@gibs/react')
    expect(codeText()).not.toContain('export default function GibToken(')
  })

  it('switches to the HTML generator', () => {
    renderCodeOutput()
    fireEvent.click(screen.getByRole('button', { name: 'HTML' }))
    expect(codeText().startsWith('<')).toBe(true)
    expect(codeText()).not.toContain('@gibs/react')
  })

  it('switches to the bare <img> generator', () => {
    renderCodeOutput()
    fireEvent.click(screen.getByRole('button', { name: '<img>' }))
    const text = codeText()
    expect(text.startsWith('<img ')).toBe(true)
    expect(text).not.toContain('<div')
  })

  // Selecting a token has to reach every generator's inputs, not just the
  // default SDK snippet — an address baked in only for one format would ship
  // a working sample for the tab someone happened to check and a hard-coded
  // zero address for the rest.
  it('bakes the selected token address into whichever format is active', () => {
    renderCodeOutput()
    fireEvent.click(screen.getByTestId('select-token'))
    fireEvent.click(screen.getByRole('button', { name: '<img>' }))
    expect(codeText()).toContain(TOKEN.address)
  })
})

describe('the mode switch only applies to React', () => {
  it('is hidden for every format except React', () => {
    renderCodeOutput()
    expect(screen.queryByRole('button', { name: 'snippet' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'React' }))
    expect(screen.getByRole('button', { name: 'snippet' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'HTML' }))
    expect(screen.queryByRole('button', { name: 'snippet' })).toBeNull()
  })

  // The component generator is a materially different code shape (a
  // reusable `GibToken` component) from the inline snippet — picking the
  // wrong one silently hands the reader the wrong kind of integration.
  it('swaps the React output between the inline snippet and the reusable component', () => {
    renderCodeOutput()
    fireEvent.click(screen.getByRole('button', { name: 'React' }))
    expect(codeText()).not.toContain('export default function GibToken(')

    fireEvent.click(screen.getByRole('button', { name: 'component' }))
    expect(codeText()).toContain('export default function GibToken(')

    fireEvent.click(screen.getByRole('button', { name: 'snippet' }))
    expect(codeText()).not.toContain('export default function GibToken(')
  })
})

describe('badge-in-img warning', () => {
  it('warns only when the img format is active AND a badge is enabled', () => {
    renderCodeOutput()
    const warning = () => screen.queryByText(/Badge requires a wrapper element/)

    // img format alone, badge still disabled by default — no warning. This is
    // the half of the condition the other assertions below cannot cover on
    // their own: without it, "always warn on the img tab" would pass too.
    fireEvent.click(screen.getByRole('button', { name: '<img>' }))
    expect(warning()).toBeNull()

    // Enabling the badge while still on img flips the warning on.
    fireEvent.click(screen.getByTestId('enable-badge'))
    expect(warning()).not.toBeNull()

    // Leaving img drops the warning even though the badge is still enabled.
    fireEvent.click(screen.getByRole('button', { name: 'HTML' }))
    expect(warning()).toBeNull()

    // Back to img with the badge still enabled — warning returns.
    fireEvent.click(screen.getByRole('button', { name: '<img>' }))
    expect(warning()).not.toBeNull()
  })
})

describe('copy buttons', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('copies the rendered code, not a stale generation, to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    renderCodeOutput()
    fireEvent.click(screen.getByRole('button', { name: '<img>' }))
    const shownCode = codeText()

    fireEvent.click(screen.getByRole('button', { name: 'Copy Code' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(shownCode))
  })

  it('copies the image URL, and reports "Copied!" for two seconds before reverting', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderCodeOutput()

    // Fake timers only once rendering has settled: faking them earlier would
    // stall the render this test needs, the same reasoning TokenDetailModal's
    // equivalent copy-revert test documents.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('Copied!')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByText('Copied!')).toBeNull()
  })

  // A user on an insecure origin or an old browser has no Clipboard API at
  // all — the button must not crash the page out from under them.
  it('does nothing observable when the Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    renderCodeOutput()
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Copy Code' }))).not.toThrow()
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.queryByText('Copied!')).toBeNull()
  })
})
