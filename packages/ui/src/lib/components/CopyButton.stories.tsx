import type { Meta, StoryObj } from '@storybook/react-vite'
import CopyButton from './CopyButton'

const ADDRESS = 'https://gib.show/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?w=64&h=64&as=webp'

const meta = {
  title: 'Components/CopyButton',
  component: CopyButton,
  args: { text: ADDRESS, label: 'Copy address' },
} satisfies Meta<typeof CopyButton>

export default meta
type Story = StoryObj<typeof meta>

/** The filled button, for the main action on a surface. */
export const Primary: Story = {}

/** The outlined button, for an action beside other content. */
export const Secondary: Story = { args: { variant: 'secondary' } }
