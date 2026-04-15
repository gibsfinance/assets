import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GibProvider, useGib } from './provider'

function ClientConsumer() {
  const client = useGib()
  return <span data-testid="base">{client.baseUrl}</span>
}

describe('GibProvider', () => {
  it('provides a client with production URL by default', () => {
    render(
      <GibProvider>
        <ClientConsumer />
      </GibProvider>,
    )
    expect(screen.getByTestId('base').textContent).toBe('https://gib.show')
  })

  it('provides a client with staging URL when staging=true', () => {
    render(
      <GibProvider staging>
        <ClientConsumer />
      </GibProvider>,
    )
    expect(screen.getByTestId('base').textContent).toBe('https://staging.gib.show')
  })

  it('provides a client with custom baseUrl', () => {
    render(
      <GibProvider baseUrl="https://custom.example.com">
        <ClientConsumer />
      </GibProvider>,
    )
    expect(screen.getByTestId('base').textContent).toBe('https://custom.example.com')
  })

  it('throws when useGib is called outside provider', () => {
    expect(() => render(<ClientConsumer />)).toThrow(
      'useGib must be used within <GibProvider>',
    )
  })
})
