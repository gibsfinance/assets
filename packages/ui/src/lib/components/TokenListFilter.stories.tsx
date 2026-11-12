import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import TokenListFilter from './TokenListFilter'
import type { Token } from '../types'

const token = (symbol: string, sourceList: string): Token => ({
  chainId: 369,
  address: `0x${symbol.padEnd(40, '0')}`,
  name: symbol,
  symbol,
  decimals: 18,
  hasIcon: true,
  sourceList,
})

const TOKENS_BY_LIST = new Map<string, Token[]>([
  ['coingecko', [token('WPLS', 'coingecko'), token('HEX', 'coingecko'), token('PLSX', 'coingecko')]],
  ['trustwallet', [token('WPLS', 'trustwallet')]],
  ['a-list-with-a-name-that-is-much-too-long-for-the-popover-to-show-in-one-line', [token('DAI', 'long')]],
])

const meta = {
  title: 'Components/TokenListFilter',
  component: TokenListFilter,
  args: {
    selectedChain: 369,
    enabledLists: new Set(['coingecko']),
    tokensByList: TOKENS_BY_LIST,
    onToggleList: () => {},
    onToggleAll: () => {},
  },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="flex h-96 w-80 justify-end">
        <Story />
      </div>
    ),
  ],
  // Holds the enabled set itself, so the checkboxes work in the canvas.
  render: function Controlled(args) {
    const [enabledLists, setEnabledLists] = useState(args.enabledLists)
    return (
      <TokenListFilter
        {...args}
        enabledLists={enabledLists}
        onToggleList={(listId, enabled) => {
          const next = new Set(enabledLists)
          if (enabled) next.add(listId)
          else next.delete(listId)
          setEnabledLists(next)
        }}
        onToggleAll={(enabled) => setEnabledLists(enabled ? new Set(TOKENS_BY_LIST.keys()) : new Set())}
      />
    )
  },
} satisfies Meta<typeof TokenListFilter>

export default meta
type Story = StoryObj<typeof meta>

/** Open the filter to pick the lists whose tokens show. */
export const Default: Story = {}

/** No lists carry tokens for the chain. */
export const NoLists: Story = { args: { tokensByList: new Map(), enabledLists: new Set() } }

/** A chain with no tokens in any list. */
export const OtherChain: Story = { args: { selectedChain: 1 } }
