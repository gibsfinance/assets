/**
 * The inline image picker used when a token in a list has no logo.
 *
 * Everything it guards is silent. An oversized or non-image file that slips through is
 * handed to the caller as a data uri — the file inlined into a `data:` address string — and
 * eventually posted to the server, where it becomes a stored asset the image pipeline
 * cannot serve; a drop the control forgets to intercept makes the browser navigate away
 * from the editor and lose unsaved work. Neither raises an error in the interface, so both
 * sides of every check are asserted here.
 *
 * The validation and file-reading helpers have their own tests; these cover the component's
 * use of them — that a rejected file never reaches onUpload, and that an accepted one does.
 * jsdom supplies a real FileReader, so the read path runs for real. No application source
 * is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import ImageUpload from './ImageUpload'

/** A file of a given media type and byte length, without materialising a huge string. */
function makeFile(type: string, bytes = 8, name = 'logo'): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

const hiddenInput = () => document.querySelector('input[type="file"]') as HTMLInputElement

const control = () => screen.getByRole('button', { name: 'Upload token image' })

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ImageUpload', () => {
  it('hands the caller the chosen image as a data uri', async () => {
    const onUpload = vi.fn()
    render(<ImageUpload onUpload={onUpload} />)

    fireEvent.change(hiddenInput(), { target: { files: [makeFile('image/png')] } })

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    const [dataUri] = onUpload.mock.calls[0] as [string]
    // The caller posts this string verbatim; a bare base64 payload, or a temporary blob
    // address that dies with the page, would reach the server as something it cannot use.
    expect(dataUri.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('accepts a file dropped on the control, not only one chosen from the picker', async () => {
    const onUpload = vi.fn()
    render(<ImageUpload onUpload={onUpload} />)

    fireEvent.drop(control(), { dataTransfer: { files: [makeFile('image/svg+xml')] } })

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    expect((onUpload.mock.calls[0][0] as string).startsWith('data:image/svg+xml;base64,')).toBe(true)
  })

  it('refuses a file whose type is not an image format the server accepts', async () => {
    const onUpload = vi.fn()
    render(<ImageUpload onUpload={onUpload} />)

    fireEvent.change(hiddenInput(), { target: { files: [makeFile('application/pdf', 8, 'notes.pdf')] } })

    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(onUpload).not.toHaveBeenCalled()
    expect(String(warn.mock.calls[0][1])).toContain('Unsupported format')
  })

  it('refuses an image over the size limit', async () => {
    const onUpload = vi.fn()
    render(<ImageUpload onUpload={onUpload} />)

    // Just past the 512 kibibyte ceiling the helper enforces.
    fireEvent.change(hiddenInput(), { target: { files: [makeFile('image/png', 512 * 1024 + 1)] } })

    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(onUpload).not.toHaveBeenCalled()
    expect(String(warn.mock.calls[0][1])).toContain('too large')
  })

  it('does nothing when a drop carries no file at all', async () => {
    const onUpload = vi.fn()
    render(<ImageUpload onUpload={onUpload} />)

    fireEvent.drop(control(), { dataTransfer: { files: [] } })

    await Promise.resolve()
    expect(onUpload).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('does nothing when the picker is dismissed without choosing anything', async () => {
    // Cancelling the file dialog still fires a change with no file behind it.
    const onUpload = vi.fn()
    render(<ImageUpload onUpload={onUpload} />)

    fireEvent.change(hiddenInput(), { target: { files: null } })

    await Promise.resolve()
    expect(onUpload).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('claims a drag as a copy and stops the browser opening the file', () => {
    // Without preventDefault the browser navigates to the dropped image and the list
    // editor, with everything unsaved in it, is gone.
    render(<ImageUpload onUpload={vi.fn()} />)
    const dataTransfer = { dropEffect: 'none', files: [] }

    const notPrevented = fireEvent.dragOver(control(), { dataTransfer })

    expect(notPrevented).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
  })

  it('reports a read failure instead of leaving the caller waiting', async () => {
    // A file the browser cannot read (removed from disk between choosing and reading,
    // permissions revoked) rejects inside the reader. The caller must not be handed a
    // half-formed value, and the failure must not escape as an unhandled rejection.
    class FailingReader {
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      result: string | null = null
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal('FileReader', FailingReader)

    const onUpload = vi.fn()
    render(<ImageUpload onUpload={onUpload} />)

    fireEvent.change(hiddenInput(), { target: { files: [makeFile('image/png')] } })

    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(onUpload).not.toHaveBeenCalled()
    expect(String(warn.mock.calls[0][1])).toContain('Failed to read file')
  })

  it('opens the file picker when the control is clicked', () => {
    // The real input is hidden; the visible control is the only way to reach it.
    render(<ImageUpload onUpload={vi.fn()} />)
    const clicked = vi.spyOn(hiddenInput(), 'click').mockImplementation(() => {})

    fireEvent.click(control())

    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('lets the same file be chosen twice in a row', async () => {
    // The input keeps its value after a change, so re-picking the file the visitor just
    // fixed would fire nothing. Clearing it is what makes a retry possible.
    //
    // The wait is not decoration and must not be removed to make this synchronous. A valid
    // file starts a real jsdom FileReader read, and the component does not await it; a test
    // that returns immediately leaves that read in flight past `afterEach`, where it lands
    // in a torn-down realm and throws "Expected an Uint8Array" out of jsdom's base64 with
    // no test left to attribute it to. Every assertion still passes and the run fails on an
    // unhandled error — intermittently, because it depends on how fast the immediate fires.
    // Waiting for onUpload keeps the read inside the test that started it.
    const onUpload = vi.fn()
    render(<ImageUpload onUpload={onUpload} />)
    const input = hiddenInput()

    fireEvent.change(input, { target: { files: [makeFile('image/png')] } })

    expect(input.value).toBe('')
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
  })

  it('previews the image already set on the token', () => {
    render(<ImageUpload onUpload={vi.fn()} currentImage="https://gib.show/image/eip155-1/0xabc" />)
    const preview = control().querySelector('img') as HTMLImageElement
    expect(preview.getAttribute('src')).toBe('https://gib.show/image/eip155-1/0xabc')
  })

  it('shows an empty affordance when the token has no image yet', () => {
    render(<ImageUpload onUpload={vi.fn()} />)
    expect(control().querySelector('img')).toBeNull()
    expect(control().querySelector('i')).toBeTruthy()
  })

  it('sizes itself to the row it sits in', () => {
    // The control is dropped into a token row of a caller-chosen height; a fixed size
    // would break the row alignment rather than fail.
    render(<ImageUpload onUpload={vi.fn()} size={48} />)
    expect(control().style.width).toBe('48px')
    expect(control().style.height).toBe('48px')
  })
})
