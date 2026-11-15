import { Fragment, type ReactNode } from 'react'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { faArrowRight, faLink } from '@fortawesome/free-solid-svg-icons'
import { Icon } from './Icon'

/**
 * How a card is laid out. `compact` is a column of preview, title, text and address, for a row of
 * three. `wide` is a full-width card whose body (its children) lays itself out.
 */
export type IntegrationCardLayout = 'compact' | 'wide'

export interface IntegrationCardProps {
  /** Which layout the card takes. */
  layout: IntegrationCardLayout
  /** The glyph beside the title. */
  icon: IconDefinition
  title: string
  description: string
  /** A small live example above the title. Only the compact layout draws it in its own panel. */
  preview?: ReactNode
  /** Under the description: an address, a snippet, or the card's own interactive example. Optional. */
  children?: ReactNode
  /** The page on the documentation site that holds the full parameter list. */
  docsHref: string
}

/** The padding and spacing of each layout. Compact cards are narrow, so they pad less than wide ones. */
const SHELL_CLASS: Record<IntegrationCardLayout, string> = {
  compact: 'glass-card flex h-full flex-col gap-3 p-5 transition-all duration-200 hover:shadow-glow-accent-subtle',
  wide: 'glass-card space-y-4 p-5 transition-all duration-200 hover:shadow-glow-accent-subtle',
}

/**
 * One card of the home page's "Simple Integration" section: a title, what it shows, its body, and a
 * link to the documentation page that covers it.
 *
 * Every card on the page has this shape, so the markup lives here once. The compact layout puts a
 * preview panel above the text, and the three compact cards share one row with equal heights. The
 * wide layout is the full width of the section, and its children take the whole body.
 *
 * @param props.layout The layout to draw.
 * @param props.icon The glyph beside the title.
 * @param props.title The card's heading.
 * @param props.description One or two sentences saying what the card shows.
 * @param props.preview The live example, for the compact layout.
 * @param props.children What the card shows under the description.
 * @param props.docsHref The documentation page for the full reference.
 */
export default function IntegrationCard({
  layout,
  icon,
  title,
  description,
  preview,
  children,
  docsHref,
}: IntegrationCardProps) {
  return (
    <div className={SHELL_CLASS[layout]}>
      {preview && (
        <div className="flex min-h-[7.5rem] items-center justify-center rounded-lg bg-surface-inset p-4">{preview}</div>
      )}

      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-accent/10 p-2.5">
          <Icon icon={icon} className="text-xl text-accent-content" />
        </div>
        <h3 className="font-heading text-lg font-bold text-content-strong">{title}</h3>
      </div>
      <p className="text-content-secondary">{description}</p>
      {children}
      <a
        href={docsHref}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto inline-flex items-center gap-2 text-sm font-medium text-accent-content hover:underline">
        Read the full documentation
        <Icon icon={faArrowRight} />
      </a>
    </div>
  )
}

/**
 * Splits an address into the pieces a line may break between: after each `?` and each `&`, so the
 * options of a query can start a new line. Joined back together, the pieces are the exact address.
 *
 * @param href The full address.
 * @returns The pieces, in order, each ending where a break may follow.
 */
export function addressSegments(href: string): string[] {
  return href.split(/(?<=[?&])/)
}

export interface IntegrationAddressProps {
  /** The full address the reader can open. */
  href: string
}

/**
 * An address shown as a link, with its text set in the monospace face so a reader can copy it.
 *
 * The text breaks only after a `?` or `&` (or anywhere when a run has no break point, such as a hex
 * address), so a long query stays readable on a narrow screen. The break points are zero-width, so
 * the copied text is exactly the address.
 *
 * @param props.href The full address. It is both the link target and the text shown.
 */
export function IntegrationAddress({ href }: IntegrationAddressProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex max-w-full min-w-0 items-center gap-2 text-sm text-content-subtle">
      <Icon icon={faLink} className="shrink-0 text-accent-content" />
      {/* Break after ? and &, first. Anywhere only when a run has no break point, such as a hex address. */}
      <code className="min-w-0 font-mono [overflow-wrap:anywhere]">
        {addressSegments(href).map((segment, index) => (
          <Fragment key={index}>
            {index > 0 && <wbr />}
            {segment}
          </Fragment>
        ))}
      </code>
    </a>
  )
}
