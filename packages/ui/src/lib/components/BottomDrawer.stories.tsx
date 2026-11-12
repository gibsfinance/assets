import type { Meta, StoryObj } from '@storybook/react-vite'
import BottomDrawer from './BottomDrawer'

const meta = {
  title: 'Components/BottomDrawer',
  component: BottomDrawer,
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobile1' } },
  args: {
    enabled: true,
    handle: <span className="text-sm font-medium">Drag me or tap</span>,
    children: (
      <div className="space-y-2 p-4 text-sm">
        <p className="font-semibold">Drawer content</p>
        <p>Tap the handle to move between closed, half and full. Drag it, or flick it, to move faster.</p>
      </div>
    ),
  },
  // The drawer only shows below the large breakpoint, so the canvas is kept narrow.
  decorators: [
    (Story) => (
      <div className="h-[600px] w-[390px] overflow-hidden">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BottomDrawer>

export default meta
type Story = StoryObj<typeof meta>

/** The drawer, closed to its handle. */
export const Default: Story = {}

/** Disabled: nothing shows. */
export const Disabled: Story = { args: { enabled: false } }

/** Content taller than the drawer scrolls inside it. */
export const LongContent: Story = {
  args: {
    children: (
      <ol className="list-decimal space-y-2 p-4 pl-8 text-sm">
        {Array.from({ length: 40 }, (_unused, index) => (
          <li key={index}>A line of drawer content, number {index + 1}.</li>
        ))}
      </ol>
    ),
  },
}
