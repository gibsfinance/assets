import type { Meta, StoryObj } from '@storybook/react-vite'
import { faImage } from '@fortawesome/free-solid-svg-icons'
import Image from './Image'
import IntegrationCard, { IntegrationAddress } from './IntegrationCard'

const WBTC_ADDRESS = 'https://gib.show/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'

const meta = {
  title: 'Components/IntegrationCard',
  component: IntegrationCard,
  args: {
    icon: faImage,
    title: 'Token Images',
    description: 'Fetch the logo for any token on any supported chain.',
    docsHref: 'https://docs.gib.show/api-reference/images/',
    preview: <Image src={WBTC_ADDRESS} alt="WBTC" size={48} fullResolution />,
    children: <IntegrationAddress href={WBTC_ADDRESS} />,
  },
} satisfies Meta<typeof IntegrationCard>

export default meta
type Story = StoryObj<typeof meta>

/** A preview, one address and a documentation link: the shape the home page cards take. */
export const Default: Story = {}

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
