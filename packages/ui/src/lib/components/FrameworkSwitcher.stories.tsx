import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import FrameworkSwitcher from './FrameworkSwitcher'

const LANGUAGES = [
  { key: 'curl', label: 'curl' },
  { key: 'js', label: 'JavaScript' },
  { key: 'react', label: 'React' },
  { key: 'html', label: 'HTML' },
]

const meta = {
  title: 'Components/FrameworkSwitcher',
  component: FrameworkSwitcher,
  args: { languages: LANGUAGES, activeLanguage: 'curl', onSelect: () => {} },
  // Holds the choice itself, so a click moves the highlight.
  render: function Controlled(args) {
    const [activeLanguage, setActiveLanguage] = useState(args.activeLanguage)
    return <FrameworkSwitcher {...args} activeLanguage={activeLanguage} onSelect={setActiveLanguage} />
  },
} satisfies Meta<typeof FrameworkSwitcher>

export default meta
type Story = StoryObj<typeof meta>

/** Click a tab to switch. */
export const Default: Story = {}

/** One option only. */
export const SingleOption: Story = { args: { languages: LANGUAGES.slice(0, 1) } }

/** Many options wrap onto more lines. */
export const ManyOptions: Story = {
  args: {
    languages: Array.from({ length: 14 }, (_unused, index) => ({
      key: `lang-${index}`,
      label: `Language ${index + 1}`,
    })),
    activeLanguage: 'lang-3',
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
}
