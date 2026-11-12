import type { Meta, StoryObj } from '@storybook/react-vite'
import BadgeConfigurator from './BadgeConfigurator'

const meta = {
  title: 'Components/BadgeConfigurator',
  component: BadgeConfigurator,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BadgeConfigurator>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The badge settings panel. It reads and writes the Studio state, so the story mounts the
 * Studio provider around it (see the global decorator). The badge starts off, and the
 * controls are dimmed until you switch it on.
 */
export const Default: Story = {}
