import type { Meta, StoryObj } from '@storybook/react-vite'
import CountUpNumber from './CountUpNumber'

const meta = {
  title: 'Components/CountUpNumber',
  component: CountUpNumber,
  args: { end: 123456, duration: 2000, className: 'font-heading text-5xl font-bold text-accent' },
} satisfies Meta<typeof CountUpNumber>

export default meta
type Story = StoryObj<typeof meta>

/** The number counts up from zero when it scrolls into view. */
export const Default: Story = {}

/** A short run. */
export const Fast: Story = { args: { end: 900, duration: 400 } }

/** Zero stays at zero. */
export const Zero: Story = { args: { end: 0 } }

/** A very large number, with the reader's thousands separators. */
export const Large: Story = { args: { end: 9876543210, duration: 3000 } }
