import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import DocsSidebar from './DocsSidebar'

const SECTIONS = [
  { id: 'images', label: 'Images' },
  { id: 'lists', label: 'Token lists' },
  { id: 'search', label: 'Search' },
  { id: 'networks', label: 'Networks' },
]

const meta = {
  title: 'Components/DocsSidebar',
  component: DocsSidebar,
  args: { sections: SECTIONS, activeSection: 'images', onSectionChange: () => {}, variant: 'desktop' },
  parameters: { layout: 'padded' },
  // Holds the active section itself, so a click moves the highlight.
  render: function Controlled(args) {
    const [activeSection, setActiveSection] = useState(args.activeSection)
    return <DocsSidebar {...args} activeSection={activeSection} onSectionChange={setActiveSection} />
  },
} satisfies Meta<typeof DocsSidebar>

export default meta
type Story = StoryObj<typeof meta>

/** The sticky side list for wide screens. */
export const Desktop: Story = {}

/** The compact bar for narrow screens. */
export const Mobile: Story = { args: { variant: 'mobile' } }

/** A long label in the narrow bar. */
export const MobileLongLabels: Story = {
  args: {
    variant: 'mobile',
    sections: SECTIONS.map((section) => ({ ...section, label: `${section.label} and everything related to it` })),
  },
}
