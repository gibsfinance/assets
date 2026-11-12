import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import RadialPositionPicker from './RadialPositionPicker'

const meta = {
  title: 'Components/RadialPositionPicker',
  component: RadialPositionPicker,
  args: { angleDeg: 135, onChange: () => {} },
  // Holds the angle itself, so dragging the handle works in the canvas.
  render: function Controlled(args) {
    const [angleDeg, setAngleDeg] = useState(args.angleDeg)
    return (
      <div className="flex flex-col items-center gap-2">
        <RadialPositionPicker {...args} angleDeg={angleDeg} onChange={setAngleDeg} />
        <span className="font-mono text-xs text-content-subtle">{angleDeg} degrees</span>
      </div>
    )
  },
} satisfies Meta<typeof RadialPositionPicker>

export default meta
type Story = StoryObj<typeof meta>

/** Drag the handle around the circle, or use a corner preset. */
export const Default: Story = {}

/** The handle at the top. */
export const Top: Story = { args: { angleDeg: 0 } }

/** The handle at the left. */
export const Left: Story = { args: { angleDeg: 270 } }
