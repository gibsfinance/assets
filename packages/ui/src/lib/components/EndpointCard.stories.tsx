import type { Meta, StoryObj } from '@storybook/react-vite'
import EndpointCard from './EndpointCard'

const meta = {
  title: 'Components/EndpointCard',
  component: EndpointCard,
  args: {
    method: 'GET',
    path: '/list/:providerKey/:listKey',
    description: 'A token list in the standard format.',
  },
  parameters: {
    layout: 'padded',
    mockApi: {
      '/list/example/top': {
        kind: 'json',
        body: {
          name: 'Example',
          tokens: [{ chainId: 1, address: '0x0000000000000000000000000000000000000001', symbol: 'EX' }],
        },
        headers: { 'x-cache': 'HIT' },
      },
      '/never': { kind: 'never' },
      '/broken': { kind: 'json', status: 500, body: { error: 'boom' } },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[48rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EndpointCard>

export default meta
type Story = StoryObj<typeof meta>

/** A card with no example is a plain row. */
export const WithoutExample: Story = {}

/** Open the card to run its example. The answer comes from a fixture. */
export const WithExample: Story = { args: { example: '/list/example/top' } }

/** The request never answers, so the panel keeps its loading line. */
export const Loading: Story = { args: { example: '/never' } }

/** The request fails, and the panel shows the status. */
export const Failing: Story = { args: { example: '/broken' } }

/** A long path and a long description wrap inside the row. */
export const LongText: Story = {
  args: {
    path: '/list/:providerKey/:listKey/with/an/unusually/long/path/:segment',
    description: 'A description that goes on for a while. '.repeat(6),
  },
}
