import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

// Mock getApiUrl to control the base URL
vi.mock('../utils', () => ({
  getApiUrl: (path: string) => `https://gib.show${path}`,
}))

// Mock Image component to capture props
vi.mock('./Image', () => ({
  default: ({ src, size }: { src: string; size: number }) => (
    <img data-testid={`image-${size}`} src={src} alt="" />
  ),
}))

import TokenImageManager from './TokenImageManager'

describe('TokenImageManager', () => {
  const defaultProps = {
    chainId: 369,
    address: '0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
    onImageChange: vi.fn(),
    onClose: vi.fn(),
  }

  it('renders preview images with buildImageUrlWithSize for each size', () => {
    render(<TokenImageManager {...defaultProps} />)

    // Each PREVIEW_SIZES (32, 64, 128, 256) should produce an img with w= and h= params
    const img32 = screen.getByTestId('image-32') as HTMLImageElement
    expect(img32.src).toContain('w=32&h=32')

    const img256 = screen.getByTestId('image-256') as HTMLImageElement
    expect(img256.src).toContain('w=256&h=256')
  })

  it('detects format from API URL', () => {
    render(<TokenImageManager {...defaultProps} />)

    // Default URI has no extension → detectImageFormat returns 'auto'
    const formatBadges = screen.getAllByText('auto')
    expect(formatBadges.length).toBeGreaterThanOrEqual(1)
  })

  it('detects format from custom data URI', () => {
    render(
      <TokenImageManager
        {...defaultProps}
        currentImageUri="data:image/svg+xml;base64,abc"
      />,
    )

    expect(screen.getAllByText('svg+xml').length).toBeGreaterThanOrEqual(1)
  })

  it('passes data URI through unchanged to Image src', () => {
    const dataUri = 'data:image/png;base64,iVBOR'
    render(<TokenImageManager {...defaultProps} currentImageUri={dataUri} />)

    // buildImageUrlWithSize passes data URIs through unchanged
    const images = screen.getAllByTestId('image-32') as HTMLImageElement[]
    const dataUriImage = images.find((img) => img.src === dataUri)
    expect(dataUriImage).toBeDefined()
  })

  describe('file upload', () => {
    // jsdom ships a FileReader, but its readAsDataURL is async and the
    // encoded result is not deterministic across versions. We stub the
    // host FileReader so onload fires synchronously with a known data URL,
    // letting us assert the resulting preview/callback value exactly.
    const STUBBED_DATA_URL = 'data:image/png;base64,STUBBEDPNG'
    let originalFileReader: typeof FileReader

    beforeEach(() => {
      originalFileReader = globalThis.FileReader
      class StubFileReader {
        result: string | null = null
        onload: (() => void) | null = null
        readAsDataURL() {
          this.result = STUBBED_DATA_URL
          this.onload?.()
        }
      }
      globalThis.FileReader = StubFileReader as unknown as typeof FileReader
    })

    afterEach(() => {
      globalThis.FileReader = originalFileReader
    })

    it('opens the hidden file input when the upload button is clicked', () => {
      const { container } = render(<TokenImageManager {...defaultProps} />)
      const ui = within(container)

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement
      const clickSpy = vi.spyOn(fileInput, 'click')

      fireEvent.click(ui.getByText('Upload image'))

      expect(clickSpy).toHaveBeenCalledTimes(1)
    })

    it('reads a selected file and updates the preview to the uploaded image', async () => {
      const onImageChange = vi.fn()
      const { container } = render(
        <TokenImageManager {...defaultProps} onImageChange={onImageChange} />,
      )
      const ui = within(container)

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement
      const file = new File(['binary'], 'logo.png', { type: 'image/png' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      // Preview src is the stubbed data URL, passed through unchanged
      await waitFor(() => {
        const images = ui.getAllByTestId('image-32') as HTMLImageElement[]
        expect(images.some((img) => img.src === STUBBED_DATA_URL)).toBe(true)
      })
      // Parent is notified with the same data URL
      expect(onImageChange).toHaveBeenCalledWith(STUBBED_DATA_URL)
    })

    it('does nothing when the file selection is empty', () => {
      const onImageChange = vi.fn()
      const { container } = render(
        <TokenImageManager {...defaultProps} onImageChange={onImageChange} />,
      )

      const fileInput = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement

      fireEvent.change(fileInput, { target: { files: [] } })

      expect(onImageChange).not.toHaveBeenCalled()
    })
  })

  describe('custom URL submit', () => {
    it('sets the preview and notifies the parent when a URL is submitted via the Set button', () => {
      const onImageChange = vi.fn()
      const { container } = render(
        <TokenImageManager {...defaultProps} onImageChange={onImageChange} />,
      )
      const ui = within(container)

      const url = 'https://example.com/coin.png'
      fireEvent.change(ui.getByPlaceholderText('Image URL...'), {
        target: { value: url },
      })
      fireEvent.click(ui.getByText('Set'))

      expect(onImageChange).toHaveBeenCalledWith(url)

      // Preview now uses the submitted URL (with size params appended)
      const images = ui.getAllByTestId('image-32') as HTMLImageElement[]
      expect(images.some((img) => img.src === `${url}?w=32&h=32`)).toBe(true)
    })

    it('clears the URL input after a successful submit', () => {
      const { container } = render(<TokenImageManager {...defaultProps} />)
      const ui = within(container)

      const input = ui.getByPlaceholderText('Image URL...') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'https://example.com/coin.png' } })
      fireEvent.click(ui.getByText('Set'))

      expect(input.value).toBe('')
    })

    it('submits the URL when Enter is pressed in the input', () => {
      const onImageChange = vi.fn()
      const { container } = render(
        <TokenImageManager {...defaultProps} onImageChange={onImageChange} />,
      )
      const ui = within(container)

      const url = 'https://example.com/token.svg'
      const input = ui.getByPlaceholderText('Image URL...')
      fireEvent.change(input, { target: { value: url } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onImageChange).toHaveBeenCalledWith(url)
    })

    it('trims surrounding whitespace from the submitted URL', () => {
      const onImageChange = vi.fn()
      const { container } = render(
        <TokenImageManager {...defaultProps} onImageChange={onImageChange} />,
      )
      const ui = within(container)

      fireEvent.change(ui.getByPlaceholderText('Image URL...'), {
        target: { value: '  https://example.com/coin.png  ' },
      })
      fireEvent.click(ui.getByText('Set'))

      expect(onImageChange).toHaveBeenCalledWith('https://example.com/coin.png')
    })

    it('does not submit a blank/whitespace-only URL', () => {
      const onImageChange = vi.fn()
      const { container } = render(
        <TokenImageManager {...defaultProps} onImageChange={onImageChange} />,
      )
      const ui = within(container)

      // Set button is disabled while the trimmed value is empty
      const setButton = ui.getByText('Set') as HTMLButtonElement
      expect(setButton.disabled).toBe(true)

      // Even forcing a keydown with whitespace must not notify the parent
      const input = ui.getByPlaceholderText('Image URL...')
      fireEvent.change(input, { target: { value: '   ' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onImageChange).not.toHaveBeenCalled()
    })
  })

  describe('reset', () => {
    it('restores the default API preview and notifies the parent', () => {
      const onImageChange = vi.fn()
      const { container } = render(
        <TokenImageManager
          {...defaultProps}
          currentImageUri="https://example.com/custom.png"
          onImageChange={onImageChange}
        />,
      )
      const ui = within(container)

      // Sanity: starts on the custom image
      const before = ui.getAllByTestId('image-32') as HTMLImageElement[]
      expect(
        before.some((img) => img.src.startsWith('https://example.com/custom.png')),
      ).toBe(true)

      fireEvent.click(ui.getByText('Reset to default'))

      // Default URI is derived from the mocked getApiUrl + chain identifier
      const expectedDefault =
        'https://gib.show/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27'
      expect(onImageChange).toHaveBeenCalledWith(expectedDefault)

      const after = ui.getAllByTestId('image-32') as HTMLImageElement[]
      expect(after.some((img) => img.src === `${expectedDefault}?w=32&h=32`)).toBe(true)
    })
  })

  describe('close', () => {
    it('invokes onClose when the close button is clicked', () => {
      const onClose = vi.fn()
      const { container } = render(
        <TokenImageManager {...defaultProps} onClose={onClose} />,
      )
      const ui = within(container)

      // The close button is the icon button in the header next to "Token Image"
      const heading = ui.getByText('Token Image')
      const header = heading.parentElement as HTMLElement
      const closeButton = within(header).getByRole('button')

      fireEvent.click(closeButton)

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
