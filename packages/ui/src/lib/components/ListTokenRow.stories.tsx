import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import ListTokenRow from './ListTokenRow'
import { SAMPLE_TOKEN, SAMPLE_TOKEN_WITHOUT_IMAGE, SAMPLE_TOKEN_WITH_LONG_TEXT } from '../storybook/fixtures'

const meta = {
  title: 'Components/ListTokenRow',
  component: ListTokenRow,
  args: { token: SAMPLE_TOKEN, onRemove: fn(), onImageClick: fn(), onImageUpload: fn() },
  // The row is sortable, so it needs the drag and drop context that the list editor gives it.
  decorators: [
    (Story, { args }) => (
      <DndContext>
        <SortableContext items={[`${args.token.chainId}-${args.token.address}`]}>
          <div className="w-[28rem] max-w-full">
            <Story />
          </div>
        </SortableContext>
      </DndContext>
    ),
  ],
} satisfies Meta<typeof ListTokenRow>

export default meta
type Story = StoryObj<typeof meta>

/** A token with an image. Click the image to edit it. */
export const WithImage: Story = {}

/** A token with no image shows the upload widget in its place. */
export const WithoutImage: Story = { args: { token: SAMPLE_TOKEN_WITHOUT_IMAGE } }

/** A long name is cut short, and the symbol stays on the right. */
export const LongText: Story = { args: { token: SAMPLE_TOKEN_WITH_LONG_TEXT } }

/** A token with no name and no symbol. */
export const Unnamed: Story = { args: { token: { ...SAMPLE_TOKEN, name: '', symbol: '' } } }
