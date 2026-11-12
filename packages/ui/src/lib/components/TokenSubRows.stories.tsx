import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import TokenSubRows from './TokenSubRows'
import { SAMPLE_REFERENCES } from '../storybook/fixtures'

const meta = {
  title: 'Components/TokenSubRows',
  component: TokenSubRows,
  args: { references: SAMPLE_REFERENCES, onNavigateToList: fn() },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TokenSubRows>

export default meta
type Story = StoryObj<typeof meta>

/** A tree of the lists that carry the token. */
export const Default: Story = {}

/** One list only: the component draws nothing. */
export const SingleList: Story = { args: { references: SAMPLE_REFERENCES.slice(0, 1) } }

/** A very long list name is cut short. */
export const LongListName: Story = {
  args: {
    references: [
      SAMPLE_REFERENCES[0],
      { ...SAMPLE_REFERENCES[1], sourceList: 'a-list-with-an-extremely-long-name-that-does-not-fit-in-the-row-at-all' },
    ],
  },
}
