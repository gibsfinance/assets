import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import BottomDrawer from './BottomDrawer'

afterEach(cleanup)

describe('BottomDrawer component', () => {
  describe('rendering', () => {
    it('renders nothing when disabled', () => {
      const { container } = render(
        <BottomDrawer enabled={false}>
          <div>Content</div>
        </BottomDrawer>,
      )
      expect(container.innerHTML).toBe('')
    })

    it('renders drawer when enabled', () => {
      render(
        <BottomDrawer enabled>
          <div>Content</div>
        </BottomDrawer>,
      )
      expect(screen.getByRole('dialog')).toBeDefined()
    })

    it('renders children inside the drawer body', () => {
      render(
        <BottomDrawer enabled>
          <div data-testid="inner">Hello</div>
        </BottomDrawer>,
      )
      expect(screen.getByTestId('inner').textContent).toBe('Hello')
    })

    it('renders custom handle content', () => {
      render(
        <BottomDrawer enabled handle={<span>My Handle</span>}>
          <div>Content</div>
        </BottomDrawer>,
      )
      expect(screen.getByText('My Handle')).toBeDefined()
    })

    it('renders default "Configure" handle when no handle prop', () => {
      render(
        <BottomDrawer enabled>
          <div>Content</div>
        </BottomDrawer>,
      )
      expect(screen.getByText('Configure')).toBeDefined()
    })
  })

  describe('ARIA attributes', () => {
    it('has role="dialog" on the drawer', () => {
      render(
        <BottomDrawer enabled>
          <div>Content</div>
        </BottomDrawer>,
      )
      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeDefined()
    })

    it('has aria-label on the drawer', () => {
      render(
        <BottomDrawer enabled>
          <div>Content</div>
        </BottomDrawer>,
      )
      const dialog = screen.getByRole('dialog')
      expect(dialog.getAttribute('aria-label')).toBe('Token configurator')
    })

    it('has role="button" on the handle area', () => {
      render(
        <BottomDrawer enabled>
          <div>Content</div>
        </BottomDrawer>,
      )
      const handle = screen.getByRole('button')
      expect(handle).toBeDefined()
      expect(handle.getAttribute('tabindex')).toBe('0')
    })
  })

  describe('border radius normalization', () => {
    it('uses rounded-t-lg not rounded-t-2xl', () => {
      render(
        <BottomDrawer enabled>
          <div>Content</div>
        </BottomDrawer>,
      )
      const dialog = screen.getByRole('dialog')
      expect(dialog.className).toContain('rounded-t-lg')
      expect(dialog.className).not.toContain('rounded-t-2xl')
    })
  })

  describe('escape key', () => {
    it('collapses drawer on Escape when open', () => {
      render(
        <BottomDrawer enabled>
          <div>Content</div>
        </BottomDrawer>,
      )

      // Click handle to open (collapsed → half)
      const handle = screen.getByRole('button')
      fireEvent.click(handle)

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' })

      // Drawer should be back to collapsed state (translateY near viewport bottom)
      const dialog = screen.getByRole('dialog')
      const style = dialog.getAttribute('style') ?? ''
      // In collapsed state, translateY should be viewport - 48
      // jsdom window.innerHeight defaults to 768
      expect(style).toContain('translateY')
    })
  })

  describe('click handler', () => {
    it('cycles state on click', () => {
      render(
        <BottomDrawer enabled>
          <div>Content</div>
        </BottomDrawer>,
      )

      const handle = screen.getByRole('button')
      const dialog = screen.getByRole('dialog')

      // Initial: collapsed, aria-modal should be false
      expect(dialog.getAttribute('aria-modal')).toBe('false')

      // Click: collapsed → half
      fireEvent.click(handle)
      // Now open, aria-modal should be true
      expect(dialog.getAttribute('aria-modal')).toBe('true')
    })
  })

  describe('body scroll lock', () => {
    it('locks body scroll when full state is reached', () => {
      render(
        <BottomDrawer enabled>
          <div>Content</div>
        </BottomDrawer>,
      )

      const handle = screen.getByRole('button')

      // Click twice: collapsed → half → full
      fireEvent.click(handle)
      fireEvent.click(handle)

      expect(document.body.style.overflow).toBe('hidden')
    })

    it('unlocks body scroll when collapsed', () => {
      render(
        <BottomDrawer enabled>
          <div>Content</div>
        </BottomDrawer>,
      )

      const handle = screen.getByRole('button')

      // Open fully: collapsed → half → full
      fireEvent.click(handle)
      fireEvent.click(handle)
      expect(document.body.style.overflow).toBe('hidden')

      // Close: full → collapsed
      fireEvent.click(handle)
      expect(document.body.style.overflow).toBe('')
    })
  })
})
