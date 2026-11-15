import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import CopyButton, { COPIED_FEEDBACK_MS } from './CopyButton'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Stands in for the clipboard, which jsdom does not provide. */
function stubClipboard(writeText: () => Promise<void>) {
  const clipboard = { writeText: vi.fn(writeText) }
  vi.stubGlobal('navigator', { ...navigator, clipboard })
  return clipboard
}

const ADDRESS = 'https://gib.show/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?w=64&h=64&as=webp'

describe('CopyButton', () => {
  it('copies the exact text it was given', async () => {
    const clipboard = stubClipboard(async () => {})
    render(<CopyButton text={ADDRESS} label="Copy address" />)

    fireEvent.click(screen.getByRole('button', { name: /Copy address/ }))

    await screen.findByRole('button', { name: /Copied!/ })
    expect(clipboard.writeText).toHaveBeenCalledWith(ADDRESS)
  })

  it('says it copied, then returns to its label after the feedback time', async () => {
    vi.useFakeTimers()
    stubClipboard(async () => {})
    render(<CopyButton text={ADDRESS} label="Copy address" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy address/ }))
    })
    expect(screen.getByRole('button', { name: /Copied!/ })).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(COPIED_FEEDBACK_MS)
    })
    expect(screen.getByRole('button', { name: /Copy address/ })).toBeTruthy()
  })

  it('keeps its label and says nothing when the clipboard refuses the copy', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    render(<CopyButton text={ADDRESS} label="Copy address" />)

    fireEvent.click(screen.getByRole('button', { name: /Copy address/ }))

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('Copied!')).toBeNull()
    expect(screen.getByRole('button', { name: /Copy address/ })).toBeTruthy()
  })

  it('draws the secondary look when asked, and the primary look by default', () => {
    const { unmount } = render(<CopyButton text={ADDRESS} label="Copy" variant="secondary" />)
    expect(screen.getByRole('button').className).toContain('border-border')
    unmount()

    render(<CopyButton text={ADDRESS} label="Copy" />)
    expect(screen.getByRole('button').className).toContain('bg-accent ')
  })
})
