import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import Image from './Image'
import { SAMPLE_ICONS } from '../storybook/fixtures'

const meta = {
  title: 'Components/Image',
  component: Image,
  args: { src: SAMPLE_ICONS.green, alt: 'Sample token icon', size: 48, onError: fn(), onLoad: fn() },
} satisfies Meta<typeof Image>

export default meta
type Story = StoryObj<typeof meta>

/** The image at its default round size. */
export const Default: Story = {}

/** A larger image in a rectangle shape. */
export const Large: Story = { args: { size: 128, className: 'rounded' } }

/** The skeleton shows until the image loads. It stays visible here because the address never answers. */
export const LoadingSkeleton: Story = {
  args: { src: 'https://example.invalid/never-loads.png', skeleton: true, shape: 'circle' },
}

/** The address fails, and the fallback renderer draws a letter in place of the image. */
export const ErrorWithFallback: Story = {
  args: {
    src: 'https://example.invalid/missing.png',
    fallback: ({ width, height }) => (
      <span
        className="flex items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-600 dark:bg-surface-3 dark:text-white/60"
        style={{ width, height }}>
        ?
      </span>
    ),
  },
}

/** The image is a link that opens in a new tab. */
export const AsLink: Story = { args: { href: 'https://gib.show', size: 64 } }

/** The same image at five sizes. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-4">
      {[24, 32, 48, 64, 96].map((size) => (
        <Image key={size} {...args} size={size} />
      ))}
    </div>
  ),
}
