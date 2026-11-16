import type { Meta, StoryObj } from '@storybook/react-vite'
import SpriteSheetExample from './SpriteSheetExample'

const meta = {
  title: 'Components/SpriteSheetExample',
  component: SpriteSheetExample,
} satisfies Meta<typeof SpriteSheetExample>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The sprite example as the home page shows it. The stylesheet it links is the live one on the
 * instance the interface talks to, so the logos appear once that instance answers.
 */
export const Default: Story = {}
