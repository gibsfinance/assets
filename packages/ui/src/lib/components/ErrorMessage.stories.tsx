import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import ErrorMessage from './ErrorMessage'

const meta = {
  title: 'Components/ErrorMessage',
  component: ErrorMessage,
  args: {
    urlType: 'token',
    chainId: 369,
    tokenAddress: '0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
    generatedUrl: 'https://gib.show/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
    onSubmitIssue: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[32rem]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ErrorMessage>

export default meta
type Story = StoryObj<typeof meta>

/** A token has no icon. The link opens a prefilled issue. */
export const MissingTokenIcon: Story = {}

/** A network has no icon. */
export const MissingNetworkIcon: Story = {
  args: { urlType: 'network', networkName: 'PulseChain', tokenAddress: '' },
}

/** A very long address and name still wrap inside the card. */
export const LongText: Story = {
  args: { urlType: 'network', networkName: 'A Network With An Extremely Long Name '.repeat(4) },
}
