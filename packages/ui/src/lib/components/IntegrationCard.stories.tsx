import type { Meta, StoryObj } from '@storybook/react-vite'
import { faImage } from '@fortawesome/free-solid-svg-icons'
import Image from './Image'
import IntegrationCard, { IntegrationAddress } from './IntegrationCard'

const WBTC_ADDRESS = 'https://gib.show/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'

const meta = {
  title: 'Components/IntegrationCard',
  component: IntegrationCard,
  args: {
    layout: 'compact',
    icon: faImage,
    title: 'Token Images',
    description: 'Fetch the logo for any token on any supported chain.',
    docsHref: 'https://docs.gib.show/api-reference/images/',
    preview: <Image src={WBTC_ADDRESS} alt="WBTC" size={64} fullResolution />,
    children: <IntegrationAddress href={WBTC_ADDRESS} />,
  },
} satisfies Meta<typeof IntegrationCard>

export default meta
type Story = StoryObj<typeof meta>

/** The compact card: a preview above the title, one address, and the documentation link at the foot. */
export const Compact: Story = {}

/** The wide card: no preview of its own, and its children draw the whole body. */
export const Wide: Story = {
  args: {
    layout: 'wide',
    preview: undefined,
    children: (
      <p className="text-sm text-content-subtle">
        The children of a wide card take the full width, for an example that needs room.
      </p>
    ),
  },
}

/** A long description and a long address, to show the text wrapping instead of pushing the card wide. */
export const LongText: Story = {
  args: {
    description:
      'Fetch the logo for any token on any supported chain, with a fallback when the preferred artwork is missing or refused for licence reasons.',
    children: (
      <IntegrationAddress href="https://gib.show/image/eip155-369/0x95B303987A60C71504D99Aa1b13B4DA07b0790ab?w=64&h=64&as=webp&contrast=dark" />
    ),
  },
}
