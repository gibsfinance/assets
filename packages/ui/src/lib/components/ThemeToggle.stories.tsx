import type { Meta, StoryObj } from '@storybook/react-vite'
import { ThemeToggle } from './ThemeToggle'

const meta = {
  title: 'Components/ThemeToggle',
  component: ThemeToggle,
} satisfies Meta<typeof ThemeToggle>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The control that switches the interface between light, dark and the system setting.
 * It changes the theme of the canvas, as it does on the site. The Theme item in the
 * Storybook toolbar sets the theme from outside.
 */
export const Default: Story = {}
