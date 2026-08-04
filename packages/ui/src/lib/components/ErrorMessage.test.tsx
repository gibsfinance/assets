/**
 * The fallback shown when no icon exists for an address.
 *
 * Its real work is the "submit an issue" link. That URL carries the template name and
 * every field the maintainers need prefilled, so if it is malformed the report either
 * does not open or arrives without the address it is about — and the visitor has no other
 * route to tell anyone the asset is missing. These assert the query string rather than
 * the wording around it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ErrorMessage from './ErrorMessage'

afterEach(cleanup)

const issueLink = () => screen.getByRole('link', { name: 'submitting an issue' })
const issueParams = () => new URL(issueLink().getAttribute('href')!).searchParams

describe('ErrorMessage', () => {
  it('points the issue link at the missing-asset template', () => {
    render(<ErrorMessage />)
    expect(issueLink().getAttribute('href')).toContain('github.com/gibsfinance/assets/issues/new')
    expect(issueParams().get('template')).toBe('missing-asset.yml')
  })

  it('prefills every field the maintainers need for a token report', () => {
    render(
      <ErrorMessage
        urlType="token"
        chainId={369}
        networkName="PulseChain"
        tokenAddress="0xabc"
        generatedUrl="https://gib.show/image/369/0xabc"
      />,
    )
    const params = issueParams()
    expect(params.get('asset-type')).toBe('Token Icon')
    expect(params.get('network-name')).toBe('PulseChain')
    expect(params.get('chain-id')).toBe('369')
    expect(params.get('token-address')).toBe('0xabc')
    expect(params.get('attempted-url')).toBe('https://gib.show/image/369/0xabc')
    expect(params.get('title')).toContain('0xabc')
  })

  it('titles a network report by network rather than by address', () => {
    // A network has no token address, so titling it the token way would file an issue
    // headed "Token icon for " with nothing after it.
    render(<ErrorMessage urlType="network" networkName="Ethereum" />)
    const params = issueParams()
    expect(params.get('asset-type')).toBe('Network Icon')
    expect(params.get('title')).toContain('Ethereum')
    expect(params.get('title')).toContain('Network icon')
  })

  it('describes the missing asset in the prose to match the type', () => {
    render(<ErrorMessage urlType="network" networkName="Ethereum" />)
    expect(screen.getByText(/network icon available/)).toBeTruthy()
  })

  it('sends an empty chain-id rather than the string "null" when none is given', () => {
    // chainId defaults to null. Interpolating it directly would put "null" in the form,
    // which a maintainer then has to recognise as absent rather than as a real value.
    render(<ErrorMessage />)
    expect(issueParams().get('chain-id')).toBe('')
  })

  it('escapes an address so it survives the query string intact', () => {
    render(<ErrorMessage tokenAddress="0x with spaces&amp" />)
    expect(issueParams().get('token-address')).toBe('0x with spaces&amp')
  })

  it('notifies the caller when the issue link is used', () => {
    const onSubmitIssue = vi.fn()
    render(<ErrorMessage onSubmitIssue={onSubmitIssue} />)
    fireEvent.click(issueLink())
    expect(onSubmitIssue).toHaveBeenCalledTimes(1)
  })

  it('opens the repository link in a new tab without leaking the referrer', () => {
    render(<ErrorMessage />)
    const repo = screen.getByRole('link', { name: 'Gib Assets repository' })
    expect(repo.getAttribute('target')).toBe('_blank')
    expect(repo.getAttribute('rel')).toContain('noopener')
  })

  it('renders without a click handler supplied', () => {
    // onSubmitIssue defaults to a no-op; clicking must not throw when it is omitted.
    render(<ErrorMessage />)
    expect(() => fireEvent.click(issueLink())).not.toThrow()
  })
})
