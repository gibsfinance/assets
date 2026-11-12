import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import ImageUpload from './ImageUpload'
import { SAMPLE_ICONS } from '../storybook/fixtures'

const meta = {
  title: 'Components/ImageUpload',
  component: ImageUpload,
  args: { onUpload: fn(), size: 32 },
} satisfies Meta<typeof ImageUpload>

export default meta
type Story = StoryObj<typeof meta>

/** Click to choose a file, or drop one on it. */
export const Empty: Story = {}

/** The widget shows the image that is set now. */
export const WithCurrentImage: Story = { args: { currentImage: SAMPLE_ICONS.blue } }

/** A larger target. */
export const Large: Story = { args: { size: 96 } }
