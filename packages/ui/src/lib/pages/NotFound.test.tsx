/**
 * The terminal route's contract.
 *
 * Previously App.tsx had no `*` route, so an unmatched hash path rendered nothing and the
 * site looked broken rather than wrong. These assert the two things that distinguish a
 * useful not-found page from that blank: it says the page is missing, and it shows which
 * address failed so the visitor can see the typo.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import NotFound from './NotFound'

afterEach(cleanup)

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>,
  )

describe('NotFound', () => {
  it('states plainly that the page does not exist', () => {
    renderAt('/nope')
    expect(screen.getByText('This page does not exist')).toBeTruthy()
    expect(screen.getByText('404')).toBeTruthy()
  })

  it('shows the address that failed, which is the whole reason not to redirect home', () => {
    // A redirect would discard this. Seeing the path is what lets someone spot their typo.
    renderAt('/studioo')
    expect(screen.getByText('#/studioo')).toBeTruthy()
  })

  it('reflects whatever path was attempted rather than a fixed string', () => {
    // Guards against the path being hardcoded — a mistake the previous test alone
    // would not catch.
    renderAt('/some/deep/missing/path')
    expect(screen.getByText('#/some/deep/missing/path')).toBeTruthy()
  })

  it('offers a way out without editing the URL', () => {
    renderAt('/nope')
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Open Studio' }).getAttribute('href')).toBe('/studio')
    expect(screen.getByRole('link', { name: 'Read the docs' }).getAttribute('href')).toBe('/docs')
  })
})
