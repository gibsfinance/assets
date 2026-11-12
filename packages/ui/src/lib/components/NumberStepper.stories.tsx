import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import NumberStepper from './NumberStepper'

const meta = {
  title: 'Components/NumberStepper',
  component: NumberStepper,
  args: { value: 64, onChange: () => {}, min: 0, max: 512, step: 8, label: 'Width' },
  // Holds the value itself, so the buttons and the field work in the canvas.
  render: function Controlled(args) {
    const [value, setValue] = useState(args.value)
    return <NumberStepper {...args} value={value} onChange={setValue} />
  },
} satisfies Meta<typeof NumberStepper>

export default meta
type Story = StoryObj<typeof meta>

/** Click the buttons, hold them to repeat, or type a number. */
export const Default: Story = {}

/** At the lowest value, the decrease button is off. */
export const AtMinimum: Story = { args: { value: 0 } }

/** At the highest value, the increase button is off. */
export const AtMaximum: Story = { args: { value: 512 } }

/** No label, and a wider field. */
export const WithoutLabel: Story = { args: { label: undefined, width: 'w-32' } }
