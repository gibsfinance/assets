import type { Meta, StoryObj } from '@storybook/react-vite'
import CodeBlock from './CodeBlock'

const meta = {
  title: 'Components/CodeBlock',
  component: CodeBlock,
  args: { code: 'curl https://gib.show/image/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', lang: 'console' },
} satisfies Meta<typeof CodeBlock>

export default meta
type Story = StoryObj<typeof meta>

/** A shell command. The block shows plain text first and colors it once the highlighter loads. */
export const Console: Story = {}

/** Markup. */
export const Html: Story = {
  args: { lang: 'html', code: '<img src="https://gib.show/image/1/0xA0b8…eB48" width="64" height="64" alt="USDC" />' },
}

/** Style rules. */
export const Css: Story = { args: { lang: 'css', code: '.token {\n  border-radius: 9999px;\n  width: 64px;\n}' } }

/** Script. */
export const Javascript: Story = {
  args: { lang: 'js', code: "const url = new URL('/image/369', 'https://gib.show')\nconsole.log(url.href)" },
}

/** The block is empty. */
export const Empty: Story = { args: { code: '' } }

/** One very long line scrolls sideways inside the block. */
export const LongLine: Story = {
  args: { code: `curl "https://gib.show/list/search?q=${'usdc-'.repeat(40)}&chainId=369"` },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
}
