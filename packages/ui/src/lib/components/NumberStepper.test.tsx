import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import NumberStepper from './NumberStepper'

afterEach(cleanup)

describe('NumberStepper component', () => {
  describe('rendering', () => {
    it('renders the current value in the input', () => {
      render(<NumberStepper value={42} onChange={vi.fn()} />)
      const input = screen.getByRole('textbox') as HTMLInputElement
      expect(input.value).toBe('42')
    })

    it('renders decrease and increase buttons', () => {
      render(<NumberStepper value={5} onChange={vi.fn()} />)
      expect(screen.getByLabelText('Decrease')).toBeDefined()
      expect(screen.getByLabelText('Increase')).toBeDefined()
    })

    it('renders label when provided', () => {
      render(<NumberStepper value={5} onChange={vi.fn()} label="Qty" />)
      expect(screen.getByText('Qty')).toBeDefined()
    })

    it('does not render label when not provided', () => {
      const { container } = render(<NumberStepper value={5} onChange={vi.fn()} />)
      const spans = container.querySelectorAll('span')
      expect(spans.length).toBe(0)
    })
  })

  describe('increment', () => {
    it('calls onChange with value + step on increase click', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={5} onChange={onChange} step={1} />)
      fireEvent.click(screen.getByLabelText('Increase'))
      expect(onChange).toHaveBeenCalledWith(6)
    })

    it('uses default step of 1', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={10} onChange={onChange} />)
      fireEvent.click(screen.getByLabelText('Increase'))
      expect(onChange).toHaveBeenCalledWith(11)
    })

    it('uses custom step value', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={10} onChange={onChange} step={5} />)
      fireEvent.click(screen.getByLabelText('Increase'))
      expect(onChange).toHaveBeenCalledWith(15)
    })
  })

  describe('decrement', () => {
    it('calls onChange with value - step on decrease click', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={5} onChange={onChange} step={1} />)
      fireEvent.click(screen.getByLabelText('Decrease'))
      expect(onChange).toHaveBeenCalledWith(4)
    })

    it('uses custom step value', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={10} onChange={onChange} step={3} />)
      fireEvent.click(screen.getByLabelText('Decrease'))
      expect(onChange).toHaveBeenCalledWith(7)
    })
  })

  describe('min/max clamping', () => {
    it('clamps to max when incrementing beyond maximum', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={9998} onChange={onChange} max={9999} />)
      fireEvent.click(screen.getByLabelText('Increase'))
      expect(onChange).toHaveBeenCalledWith(9999)
    })

    it('clamps to max when increment would exceed it', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={98} onChange={onChange} max={100} step={5} />)
      fireEvent.click(screen.getByLabelText('Increase'))
      expect(onChange).toHaveBeenCalledWith(100)
    })

    it('clamps to min when decrementing below minimum', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={1} onChange={onChange} min={0} />)
      fireEvent.click(screen.getByLabelText('Decrease'))
      expect(onChange).toHaveBeenCalledWith(0)
    })

    it('clamps to min when decrement would go below it', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={2} onChange={onChange} min={0} step={5} />)
      fireEvent.click(screen.getByLabelText('Decrease'))
      expect(onChange).toHaveBeenCalledWith(0)
    })

    it('uses default min of 0 — button disabled at boundary', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={0} onChange={onChange} />)
      const btn = screen.getByLabelText('Decrease') as HTMLButtonElement
      expect(btn.disabled).toBe(true)
      // Click on disabled button does not fire onChange
      fireEvent.click(btn)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('uses default max of 9999 — button disabled at boundary', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={9999} onChange={onChange} />)
      const btn = screen.getByLabelText('Increase') as HTMLButtonElement
      expect(btn.disabled).toBe(true)
      // Click on disabled button does not fire onChange
      fireEvent.click(btn)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('disables decrease button when at min', () => {
      render(<NumberStepper value={0} onChange={vi.fn()} min={0} />)
      const btn = screen.getByLabelText('Decrease') as HTMLButtonElement
      expect(btn.disabled).toBe(true)
    })

    it('disables increase button when at max', () => {
      render(<NumberStepper value={100} onChange={vi.fn()} max={100} />)
      const btn = screen.getByLabelText('Increase') as HTMLButtonElement
      expect(btn.disabled).toBe(true)
    })

    it('enables both buttons when in range', () => {
      render(<NumberStepper value={50} onChange={vi.fn()} min={0} max={100} />)
      const decrease = screen.getByLabelText('Decrease') as HTMLButtonElement
      const increase = screen.getByLabelText('Increase') as HTMLButtonElement
      expect(decrease.disabled).toBe(false)
      expect(increase.disabled).toBe(false)
    })
  })

  describe('input change', () => {
    it('calls onChange with parsed and clamped numeric value', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={5} onChange={onChange} min={0} max={100} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '42' } })
      expect(onChange).toHaveBeenCalledWith(42)
    })

    it('clamps input value to max', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={5} onChange={onChange} min={0} max={100} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '999' } })
      expect(onChange).toHaveBeenCalledWith(100)
    })

    it('clamps input value to min', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={5} onChange={onChange} min={10} max={100} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '3' } })
      expect(onChange).toHaveBeenCalledWith(10)
    })

    it('ignores empty string input', () => {
      const onChange = vi.fn()
      render(<NumberStepper value={5} onChange={onChange} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '' } })
      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
