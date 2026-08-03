/**
 * The row of language tabs above the documentation code samples.
 *
 * It is fully controlled: it owns no state, so the only two things it can get wrong are
 * which tab it marks as current and what key it hands back when one is pressed. Both fail
 * silently — a switcher that reports the wrong key swaps the sample to the wrong language
 * without any error, and one that marks the wrong tab as current leaves the reader looking
 * at a highlighted tab whose code is not on screen. Neither throws, so only a test catches
 * them.
 *
 * The selected tab is published through `aria-selected` rather than a colour class,
 * because that is the part assistive technology and the tests can both read; asserting on
 * the class string would only restate the markup.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import FrameworkSwitcher from './FrameworkSwitcher'

const languages = [
  { key: 'javascript', label: 'JavaScript' },
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
]

afterEach(cleanup)

/** Keys of the tabs currently marked as selected, in render order. */
const selectedKeys = () =>
  screen
    .getAllByRole('tab')
    .map((tab, index) => (tab.getAttribute('aria-selected') === 'true' ? languages[index].key : null))
    .filter((key): key is string => key !== null)

describe('FrameworkSwitcher', () => {
  it('offers one tab per language it was given', () => {
    render(<FrameworkSwitcher languages={languages} activeLanguage="javascript" onSelect={vi.fn()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(languages.map((language) => language.label))
  })

  it('marks exactly the active language as current', () => {
    render(<FrameworkSwitcher languages={languages} activeLanguage="html" onSelect={vi.fn()} />)
    expect(selectedKeys()).toEqual(['html'])
  })

  it('follows the active language it is told, rather than remembering its own', () => {
    // The component is controlled — the page owns the selection. If it ever kept its own
    // copy, the highlight would stop tracking the code sample actually being shown.
    const { rerender } = render(
      <FrameworkSwitcher languages={languages} activeLanguage="html" onSelect={vi.fn()} />,
    )
    rerender(<FrameworkSwitcher languages={languages} activeLanguage="css" onSelect={vi.fn()} />)
    expect(selectedKeys()).toEqual(['css'])
  })

  it('reports the key of the pressed tab, not its label or its position', () => {
    // The key is what the page looks the code sample up by, so handing back the visible
    // label instead would silently show the wrong sample.
    const onSelect = vi.fn()
    render(<FrameworkSwitcher languages={languages} activeLanguage="javascript" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('tab', { name: 'CSS' }))
    expect(onSelect.mock.calls).toEqual([['css']])
  })

  it('still reports a press on the tab that is already current', () => {
    // Suppressing this would be an easy optimisation to reach for, and it would break any
    // page that uses the press for anything besides changing the selection.
    const onSelect = vi.fn()
    render(<FrameworkSwitcher languages={languages} activeLanguage="html" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('tab', { name: 'HTML' }))
    expect(onSelect.mock.calls).toEqual([['html']])
  })

  it('selects nothing when the active language is not one it offers', () => {
    render(<FrameworkSwitcher languages={languages} activeLanguage="rust" onSelect={vi.fn()} />)
    expect(selectedKeys()).toEqual([])
  })

  it('renders an empty labelled tab list rather than failing on no languages', () => {
    render(<FrameworkSwitcher languages={[]} activeLanguage="javascript" onSelect={vi.fn()} />)
    const list = screen.getByRole('tablist')
    expect(list.getAttribute('aria-label')).toBe('Code language selector')
    expect(screen.queryAllByRole('tab')).toEqual([])
  })
})
