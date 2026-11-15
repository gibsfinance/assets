import type { ReactNode } from 'react'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { faArrowRight, faLink } from '@fortawesome/free-solid-svg-icons'
import { Icon } from './Icon'

export interface IntegrationCardProps {
  /** The glyph beside the title. */
  icon: IconDefinition
  title: string
  description: string
  /** The live example, drawn in the left half on wide screens and above the text on narrow ones. */
  preview: ReactNode
  /** Under the description: addresses, a snippet or a note about options. Optional. */
  children?: ReactNode
  /** The page on the documentation site that holds the full parameter list. */
  docsHref: string
}

/**
 * One card of the home page's "Simple Integration" section: a live example beside its
 * explanation, the addresses it uses, and a link to the documentation page that covers it.
 *
 * Every card on the page has this shape, so the layout lives here once. The example panel
 * takes whatever the caller draws in it; the text panel takes the children under the
 * description.
 *
 * @param props.icon The glyph beside the title.
 * @param props.title The card's heading.
 * @param props.description One or two sentences saying what the card shows.
 * @param props.preview The live example.
 * @param props.children What sits under the description.
 * @param props.docsHref The documentation page for the full reference.
 */
export default function IntegrationCard({
  icon,
  title,
  description,
  preview,
  children,
  docsHref,
}: IntegrationCardProps) {
  return (
    <div className="glass-card p-6 transition-all duration-200 hover:shadow-glow-accent-subtle">
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        {/* Visual Preview. min-w-0 lets a column shrink below its widest child, so a long line scrolls inside it. */}
        <div className="flex min-w-0 items-center justify-center rounded-lg bg-surface-inset p-4">{preview}</div>

        {/* Description */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-accent/10 p-3">
              <Icon icon={icon} className="text-2xl text-accent-content" />
            </div>
            <h3 className="font-heading text-lg font-bold text-content-strong">{title}</h3>
          </div>
          <p className="text-content-secondary">{description}</p>
          {children}
          <a
            href={docsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-accent-content hover:underline">
            Read the full documentation
            <Icon icon={faArrowRight} />
          </a>
        </div>
      </div>
    </div>
  )
}

export interface IntegrationAddressProps {
  /** The full address the reader can open. */
  href: string
}

/**
 * An address shown as a link, with its text set in the monospace face so a reader can copy it.
 *
 * @param props.href The full address. It is both the link target and the text shown.
 */
export function IntegrationAddress({ href }: IntegrationAddressProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-sm text-content-subtle">
      <Icon icon={faLink} className="shrink-0 text-accent-content" />
      <code className="break-all font-mono">{href}</code>
    </a>
  )
}
