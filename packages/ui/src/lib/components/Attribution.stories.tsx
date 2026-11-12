import type { Meta, StoryObj } from '@storybook/react-vite'
import Attribution from './Attribution'

const meta = {
  title: 'Components/Attribution',
  component: Attribution,
} satisfies Meta<typeof Attribution>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The logos of the providers that supply the artwork. The logo files belong to the site, at
 * `/logos/`, so a Storybook served from another path may show the links without the logos.
 * Switch the theme in the toolbar: the component picks the dark or the light logo set.
 */
export const Default: Story = {}
