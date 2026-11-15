import type { Meta, StoryObj } from '@storybook/react-vite'
import ImageOptionsExample from './ImageOptionsExample'

const meta = {
  title: 'Components/ImageOptionsExample',
  component: ImageOptionsExample,
} satisfies Meta<typeof ImageOptionsExample>

export default meta
type Story = StoryObj<typeof meta>

/** The example as the home page shows it: the first option selected, with its preview and addresses. */
export const Default: Story = {}
