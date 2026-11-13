import type { Meta, StoryObj } from '@storybook/react-vite'
import { faCamera, faCheck, faSpinner, faTrashCan } from '@fortawesome/free-solid-svg-icons'
import { Icon } from './Icon'

const meta = {
  title: 'Components/Icon',
  component: Icon,
  args: { icon: faCamera, className: 'text-2xl' },
} satisfies Meta<typeof Icon>

export default meta
type Story = StoryObj<typeof meta>

/** One glyph. It takes its size and color from the text around it. */
export const Default: Story = {}

/** A glyph that turns, for a busy state. */
export const Spinning: Story = { args: { icon: faSpinner, spin: true } }

/** Text classes tint the glyph. */
export const Tinted: Story = { args: { icon: faTrashCan, className: 'text-2xl text-danger-strong' } }

/** A few glyphs at several sizes. */
export const Gallery: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-accent-content">
      <Icon icon={faCheck} className="text-sm" />
      <Icon icon={faCheck} className="text-xl" />
      <Icon icon={faCheck} className="text-4xl" />
    </div>
  ),
}
