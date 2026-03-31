import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock child components to isolate EndpointCard behavior
vi.mock('./CodeBlock', () => ({ default: ({ code }: { code: string }) => <pre data-testid="code">{code}</pre> }))
vi.mock('./Image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img data-testid="image" src={src} alt={alt} />,
}))

import EndpointCard from './EndpointCard'

describe('EndpointCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
})
