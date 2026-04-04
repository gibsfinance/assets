import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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
})
