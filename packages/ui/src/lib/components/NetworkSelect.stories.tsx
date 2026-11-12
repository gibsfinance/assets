import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import NetworkSelect from './NetworkSelect'
import { FAILING_NETWORK_ROUTES, NETWORK_ROUTES, PENDING_NETWORK_ROUTES } from '../storybook/fixtures'

const meta = {
  title: 'Components/NetworkSelect',
  component: NetworkSelect,
  args: { selectedChainId: null, onSelect: () => {} },
  parameters: { mockApi: NETWORK_ROUTES },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  // Holds the selection itself, so picking a network in the dialog shows in the button.
  render: function Controlled(args) {
    const [selectedChainId, setSelectedChainId] = useState(args.selectedChainId)
    return <NetworkSelect {...args} selectedChainId={selectedChainId} onSelect={setSelectedChainId} />
  },
} satisfies Meta<typeof NetworkSelect>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing chosen. Open the picker to search the list. */
export const Empty: Story = {}

/** A network is chosen, and a clear button appears. */
export const Selected: Story = { args: { selectedChainId: 'eip155-369' } }

/** A bare number from an old bookmark still finds its network. */
export const SelectedByBareNumber: Story = { args: { selectedChainId: '1' } }

/** The network requests never answer, so the picker has nothing to list. */
export const Loading: Story = { parameters: { mockApi: PENDING_NETWORK_ROUTES } }

/** The network requests fail, so the picker has nothing to list. */
export const Error: Story = { parameters: { mockApi: FAILING_NETWORK_ROUTES } }
