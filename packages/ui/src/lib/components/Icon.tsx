import type { SVGProps } from 'react'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** The glyph to draw. Import it by name so the bundle keeps only the glyphs in use. */
  icon: IconDefinition
  /** Turn the glyph once every two seconds, the way Font Awesome's `fa-spin` did. */
  spin?: boolean
}

/**
 * Draws one Font Awesome glyph as an inline SVG.
 *
 * The glyph is one em tall and as wide as its own aspect ratio, and it takes its colour
 * from the surrounding text, so `text-*` classes size and tint it as they did the font.
 * Height and width are attributes rather than inline style so a class such as `w-4` can
 * still override them. The `icon` class in `app.css` sets the inline alignment.
 * The glyph is decoration: the element that holds it carries the accessible name.
 */
export function Icon({ icon, spin, className, ...rest }: IconProps) {
  const [width, height, , , path] = icon.icon
  const classNames = ['icon', spin && 'icon-spin', className].filter(Boolean).join(' ')
  return (
    <svg
      {...rest}
      className={classNames}
      viewBox={`0 0 ${width} ${height}`}
      width={`${width / height}em`}
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      data-icon={icon.iconName}>
      {[path].flat().map((segment) => (
        <path key={segment} d={segment} />
      ))}
    </svg>
  )
}
