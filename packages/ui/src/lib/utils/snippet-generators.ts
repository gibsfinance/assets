/**
 * @module snippet-generators
 *
 * Pure functions that emit the copy-paste code snippets shown in the
 * Studio's "Code Output" panel. Each generator returns a deterministic
 * string given its inputs — no React, no DOM, no side effects.
 *
 * Extracted from `CodeOutput.tsx` so the output of every combination
 * (shape, shadow, padding, badge flags, etc.) can be validated by
 * parsing it through `@babel/parser` (for JSX/SDK output) or jsdom
 * (for raw HTML) in unit tests.
 *
 * User-influenced values (token names from external lists, URLs) are
 * escaped per context — see escapeHtmlAttribute / escapeJsSingleQuoted.
 */
import type { StudioAppearance, BadgeConfig } from '../types'
import { badgePositionToCSS } from './badge-position'
import { shadowToCSS, shapeToCSS } from './code-output'

/**
 * Escape a value for interpolation into a double-quoted HTML or JSX
 * attribute. Token names come from external token lists — a name like
 * `Foo "Bar" <Token>` must not be able to break out of the attribute
 * or inject markup into the generated snippet. JSX attribute string
 * literals decode HTML entities, so the same escaping serves both
 * HTML and JSX contexts.
 *
 * @param value - Untrusted text destined for a `"`-quoted attribute.
 * @returns The value with `&`, `"`, `<`, and `>` entity-escaped.
 */
export function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Escape a value for interpolation into a single-quoted JavaScript
 * string literal (e.g. a generated default parameter). A quote or
 * backslash in a token name must not break the generated module.
 *
 * @param value - Untrusted text destined for a `'`-quoted JS string.
 * @returns The value with backslashes and single quotes escaped.
 */
export function escapeJsSingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Badge wrapper styling fields with their preview defaults applied.
 * The StudioConfigurator live preview is the source of truth for these
 * semantics — the generated snippets must match what the user sees.
 */
function badgeWrapperConfig(badge: BadgeConfig) {
  const badgeShape = badge.badgeShape ?? 'circle'
  const badgePadding = badge.badgePadding ?? 0
  const badgeBackground = badge.badgeBackground ?? 'transparent'
  return {
    badgePadding,
    badgeBackground,
    badgeBorderRadius: badgeShape === 'circle' ? '50%' : '0',
    // The preview wraps the badge image in a styled div whenever padding or
    // background are active; otherwise a bare image is visually identical.
    needsBadgeWrapper: badgePadding > 0 || badgeBackground !== 'transparent',
  }
}

/**
 * Emits a `@gibs/react` SDK usage snippet (GibProvider + TokenImage).
 *
 * @param chainId    - Numeric chain id as a string (e.g. `'1'`, `'369'`)
 * @param address    - Token contract address (already validated upstream)
 * @param appearance - Studio appearance config; only `width` and `shape` are read
 */
export function generateSdkSnippet(chainId: string, address: string, appearance: StudioAppearance): string {
  const { width, shape } = appearance
  const shapeAttr = shape === 'square' ? ' shape="square"' : ''
  return [
    `import { GibProvider, TokenImage } from '@gibs/react'`,
    ``,
    `<GibProvider>`,
    `  <TokenImage`,
    `    chainId={${chainId}}`,
    `    address="${escapeHtmlAttribute(address)}"`,
    `    size={${width}}${shapeAttr}`,
    `    skeleton`,
    `    lazy`,
    `  />`,
    `</GibProvider>`,
  ].join('\n')
}

/**
 * Emits inline React JSX (single expression — a fragment / element).
 *
 * Chooses the minimal markup needed:
 *   - bare `<img>` when no wrapper is required (no badge, no padding,
 *     no shadow, transparent background)
 *   - wrapper `<div>` + `<img>` when cosmetic styling is present
 *   - wrapper `<div>` + token `<img>` + badge `<img>` when badge enabled
 *     (the badge gains its own styled wrapper when badge padding or
 *     background are configured, mirroring the live preview)
 */
export function generateReactSnippet(
  tokenName: string,
  imageUrl: string,
  networkUrl: string,
  appearance: StudioAppearance,
  badge: BadgeConfig,
): string {
  const { width, height, shape, borderRadius, padding, shadow, backgroundColor } = appearance
  const borderRadiusCSS = shapeToCSS(shape, borderRadius)
  const shadowCSS = shadowToCSS(shadow)
  const paddedWidth = width + padding * 2
  const paddedHeight = height + padding * 2
  const alt = escapeHtmlAttribute(tokenName)
  const src = escapeHtmlAttribute(imageUrl)
  const badgeSrc = escapeHtmlAttribute(networkUrl)

  const imgStyleParts: string[] = [`width: ${width}`, `height: ${height}`, `borderRadius: '${borderRadiusCSS}'`]

  const wrapperStyleParts: string[] = [`borderRadius: '${borderRadiusCSS}'`]
  if (padding > 0) wrapperStyleParts.push(`padding: ${padding}`)
  if (shadowCSS) wrapperStyleParts.push(`boxShadow: '${shadowCSS}'`)
  if (backgroundColor !== 'transparent') wrapperStyleParts.push(`backgroundColor: '${backgroundColor}'`)

  const imgStyle = `{ ${imgStyleParts.join(', ')} }`
  const needsWrapper = badge.enabled || padding > 0 || shadowCSS || backgroundColor !== 'transparent'

  if (!needsWrapper) {
    return `<img\n  src="${src}"\n  alt="${alt}"\n  style={${imgStyle}}\n/>`
  }

  if (!badge.enabled) {
    const wrapperStyle = `{ display: 'inline-block', ${wrapperStyleParts.join(', ')} }`
    return [`<div style={${wrapperStyle}}>`, `  <img src="${src}" alt="${alt}" style={${imgStyle}} />`, `</div>`].join(
      '\n',
    )
  }

  const { top, left, badgeSize } = badgePositionToCSS(paddedWidth, badge.angleDeg, badge.sizeRatio, badge.overlap)

  const { badgePadding, badgeBackground, badgeBorderRadius, needsBadgeWrapper } = badgeWrapperConfig(badge)
  const ringOffset = badge.ringEnabled ? badge.ringThickness : 0
  const positionOffset = ringOffset + badgePadding
  const containerStyle = `{ position: 'relative', display: 'inline-block', width: ${paddedWidth}, height: ${paddedHeight}, ${wrapperStyleParts.join(', ')} }`

  let badgeLines: string[]
  if (!needsBadgeWrapper) {
    const badgeStyleParts = [
      "position: 'absolute'",
      `top: ${Math.round(top) - positionOffset}`,
      `left: ${Math.round(left) - positionOffset}`,
      `width: ${Math.round(badgeSize)}`,
      `height: ${Math.round(badgeSize)}`,
      `borderRadius: '${badgeBorderRadius}'`,
    ]
    if (badge.ringEnabled) {
      badgeStyleParts.push(`border: '${badge.ringThickness}px solid ${badge.ringColor}'`)
    }
    badgeLines = [
      `  <img`,
      `    src="${badgeSrc}"`,
      `    alt="Network"`,
      `    style={{ ${badgeStyleParts.join(', ')} }}`,
      `  />`,
    ]
  } else {
    // Match the live preview: a styled wrapper carries padding, background,
    // and the ring; the position offset keeps the badge image centered.
    const badgeWrapperParts = [
      `position: 'absolute'`,
      `top: ${Math.round(top) - positionOffset}`,
      `left: ${Math.round(left) - positionOffset}`,
      `borderRadius: '${badgeBorderRadius}'`,
    ]
    if (badgePadding > 0) badgeWrapperParts.push(`padding: ${badgePadding}`)
    if (badgeBackground !== 'transparent') badgeWrapperParts.push(`backgroundColor: '${badgeBackground}'`)
    if (badge.ringEnabled) {
      badgeWrapperParts.push(`border: '${badge.ringThickness}px solid ${badge.ringColor}'`)
    }
    const badgeImgParts = [
      `width: ${Math.round(badgeSize)}`,
      `height: ${Math.round(badgeSize)}`,
      `borderRadius: '${badgeBorderRadius}'`,
      `display: 'block'`,
    ]
    badgeLines = [
      `  <div style={{ ${badgeWrapperParts.join(', ')} }}>`,
      `    <img src="${badgeSrc}" alt="Network" style={{ ${badgeImgParts.join(', ')} }} />`,
      `  </div>`,
    ]
  }

  return [
    `<div style={${containerStyle}}>`,
    `  <img`,
    `    src="${src}"`,
    `    alt="${alt}"`,
    `    style={${imgStyle}}`,
    `  />`,
    ...badgeLines,
    `</div>`,
  ].join('\n')
}

/**
 * Emits a full `GibToken` component file — a drop-in React module with
 * typed props and optional badge math computed at render time.
 */
export function generateReactComponent(
  tokenName: string,
  imageUrl: string,
  networkUrl: string,
  appearance: StudioAppearance,
  badge: BadgeConfig,
): string {
  const { width, shape, borderRadius, shadow } = appearance
  const borderRadiusCSS = shapeToCSS(shape, borderRadius)
  const shadowCSS = shadowToCSS(shadow)
  const srcDefault = escapeJsSingleQuoted(imageUrl)
  const altDefault = escapeJsSingleQuoted(tokenName)
  const badgeSrc = escapeHtmlAttribute(networkUrl)

  const shadowProp = shadowCSS ? `\n  shadow?: boolean` : ''
  const shadowStyle = shadowCSS ? `\n    ...(shadow && { boxShadow: '${shadowCSS}' }),` : ''

  const badgeProps = badge.enabled
    ? `\n  badge?: boolean\n  badgeAngle?: number\n  badgeSizeRatio?: number\n  badgeOverlap?: number`
    : ''

  const badgeBlock = badge.enabled
    ? [
        ``,
        `  const rad = (badgeAngle - 90) * (Math.PI / 180)`,
        `  const badgeSize = size * badgeSizeRatio`,
        `  const radius = size / 2 + (badgeSize / 2) * (1 - badgeOverlap * 2)`,
        `  const badgeLeft = size / 2 + Math.cos(rad) * radius - badgeSize / 2`,
        `  const badgeTop = size / 2 + Math.sin(rad) * radius - badgeSize / 2`,
        ``,
      ].join('\n')
    : ''

  const wrapperOpen = badge.enabled
    ? `  return (\n    <div style={{ position: 'relative', display: 'inline-block', width: size, height: size }}>`
    : `  return (`
  const wrapperClose = badge.enabled ? `    </div>\n  )` : `  )`

  const imgIndent = badge.enabled ? '      ' : '    '
  const imgLines = [
    `<img`,
    `  src={src}`,
    `  alt={alt}`,
    `  width={size}`,
    `  height={size}`,
    `  style={{`,
    `    width: size,`,
    `    height: size,`,
    `    borderRadius: '${borderRadiusCSS}',${shadowStyle}`,
    `  }}`,
    `/>`,
  ]
    .map((line) => `${imgIndent}${line}`)
    .join('\n')

  const { badgePadding, badgeBackground, badgeBorderRadius, needsBadgeWrapper } = badgeWrapperConfig(badge)

  let badgeImgLines = ''
  if (badge.enabled && !needsBadgeWrapper) {
    badgeImgLines = [
      `      <img`,
      `        src="${badgeSrc}"`,
      `        alt="Network"`,
      `        style={{`,
      `          position: 'absolute',`,
      `          top: badgeTop,`,
      `          left: badgeLeft,`,
      `          width: badgeSize,`,
      `          height: badgeSize,`,
      `          borderRadius: '${badgeBorderRadius}',`,
      badge.ringEnabled ? `          border: '${badge.ringThickness}px solid ${badge.ringColor}',` : '',
      `        }}`,
      `      />`,
    ]
      .filter(Boolean)
      .join('\n')
  } else if (badge.enabled) {
    // Match the live preview: a styled wrapper carries padding, background,
    // and the ring; the offset keeps the badge image centered at runtime.
    const ringOffset = badge.ringEnabled ? badge.ringThickness : 0
    const positionOffset = ringOffset + badgePadding
    const badgeWrapperStyle = [
      `position: 'absolute',`,
      `top: badgeTop - ${positionOffset},`,
      `left: badgeLeft - ${positionOffset},`,
      `borderRadius: '${badgeBorderRadius}',`,
      ...(badgePadding > 0 ? [`padding: ${badgePadding},`] : []),
      ...(badgeBackground !== 'transparent' ? [`backgroundColor: '${badgeBackground}',`] : []),
      ...(badge.ringEnabled ? [`border: '${badge.ringThickness}px solid ${badge.ringColor}',`] : []),
    ]
    badgeImgLines = [
      `      <div`,
      `        style={{`,
      ...badgeWrapperStyle.map((line) => `          ${line}`),
      `        }}`,
      `      >`,
      `        <img`,
      `          src="${badgeSrc}"`,
      `          alt="Network"`,
      `          style={{`,
      `            width: badgeSize,`,
      `            height: badgeSize,`,
      `            borderRadius: '${badgeBorderRadius}',`,
      `            display: 'block',`,
      `          }}`,
      `        />`,
      `      </div>`,
    ].join('\n')
  }

  const badgeConditional = badge.enabled ? `\n      {badge && (\n${badgeImgLines}\n      )}` : ''

  return [
    `import type { CSSProperties } from 'react'`,
    ``,
    `interface GibTokenProps {`,
    `  /** Override the image src — defaults to the gib.show API URL */`,
    `  src?: string`,
    `  alt?: string`,
    `  size?: number${shadowProp}${badgeProps}`,
    `}`,
    ``,
    `export default function GibToken({`,
    `  src = '${srcDefault}',`,
    `  alt = '${altDefault}',`,
    `  size = ${width}${badge.enabled ? `,\n  badge = true,\n  badgeAngle = ${badge.angleDeg},\n  badgeSizeRatio = ${badge.sizeRatio},\n  badgeOverlap = ${badge.overlap}` : ''},`,
    `}: GibTokenProps) {${badgeBlock}`,
    wrapperOpen,
    imgLines,
    badgeConditional,
    wrapperClose,
    `}`,
  ].join('\n')
}

/**
 * Emits a raw HTML string — `<img>` plus, if needed, a wrapping `<div>`
 * and a second `<img>` for the network badge. Inline `style` attributes
 * only; no CSS classes.
 */
export function generateHtmlSnippet(
  tokenName: string,
  imageUrl: string,
  networkUrl: string,
  appearance: StudioAppearance,
  badge: BadgeConfig,
): string {
  const { width, height, shape, borderRadius, padding, shadow, backgroundColor } = appearance
  const borderRadiusCSS = shapeToCSS(shape, borderRadius)
  const shadowCSS = shadowToCSS(shadow)
  const paddedWidth = width + padding * 2
  const paddedHeight = height + padding * 2
  const alt = escapeHtmlAttribute(tokenName)
  const src = escapeHtmlAttribute(imageUrl)
  const badgeSrc = escapeHtmlAttribute(networkUrl)

  const imgStyleParts = [`width: ${width}px`, `height: ${height}px`, `border-radius: ${borderRadiusCSS}`]
  const imgStyle = imgStyleParts.join('; ')

  const wrapperStyleParts = [`border-radius: ${borderRadiusCSS}`]
  if (padding > 0) wrapperStyleParts.push(`padding: ${padding}px`)
  if (shadowCSS) wrapperStyleParts.push(`box-shadow: ${shadowCSS}`)
  if (backgroundColor !== 'transparent') wrapperStyleParts.push(`background: ${backgroundColor}`)

  const needsWrapper = badge.enabled || padding > 0 || shadowCSS || backgroundColor !== 'transparent'

  if (!needsWrapper) {
    return `<img src="${src}" alt="${alt}" style="${imgStyle}" />`
  }

  if (!badge.enabled) {
    const wrapperStyle = `display: inline-block; ${wrapperStyleParts.join('; ')}`
    return [`<div style="${wrapperStyle}">`, `  <img src="${src}" alt="${alt}" style="${imgStyle}" />`, `</div>`].join(
      '\n',
    )
  }

  const { top, left, badgeSize } = badgePositionToCSS(paddedWidth, badge.angleDeg, badge.sizeRatio, badge.overlap)

  const { badgePadding, badgeBackground, badgeBorderRadius, needsBadgeWrapper } = badgeWrapperConfig(badge)
  const htmlRingOffset = badge.ringEnabled ? badge.ringThickness : 0
  const positionOffset = htmlRingOffset + badgePadding
  const containerStyle = `position: relative; display: inline-block; width: ${paddedWidth}px; height: ${paddedHeight}px; ${wrapperStyleParts.join('; ')}`

  let badgeMarkup: string
  if (!needsBadgeWrapper) {
    const badgeStyleParts = [
      'position: absolute',
      `top: ${Math.round(top) - positionOffset}px`,
      `left: ${Math.round(left) - positionOffset}px`,
      `width: ${Math.round(badgeSize)}px`,
      `height: ${Math.round(badgeSize)}px`,
      `border-radius: ${badgeBorderRadius}`,
    ]
    if (badge.ringEnabled) {
      badgeStyleParts.push(`border: ${badge.ringThickness}px solid ${badge.ringColor}`)
    }
    badgeMarkup = `  <img src="${badgeSrc}" alt="Network" style="${badgeStyleParts.join('; ')}" />`
  } else {
    // Match the live preview: a styled wrapper carries padding, background,
    // and the ring; the position offset keeps the badge image centered.
    const badgeWrapperParts = [
      'position: absolute',
      `top: ${Math.round(top) - positionOffset}px`,
      `left: ${Math.round(left) - positionOffset}px`,
      `border-radius: ${badgeBorderRadius}`,
    ]
    if (badgePadding > 0) badgeWrapperParts.push(`padding: ${badgePadding}px`)
    if (badgeBackground !== 'transparent') badgeWrapperParts.push(`background: ${badgeBackground}`)
    if (badge.ringEnabled) {
      badgeWrapperParts.push(`border: ${badge.ringThickness}px solid ${badge.ringColor}`)
    }
    const badgeImgStyle = [
      `width: ${Math.round(badgeSize)}px`,
      `height: ${Math.round(badgeSize)}px`,
      `border-radius: ${badgeBorderRadius}`,
      'display: block',
    ].join('; ')
    badgeMarkup = [
      `  <div style="${badgeWrapperParts.join('; ')}">`,
      `    <img src="${badgeSrc}" alt="Network" style="${badgeImgStyle}" />`,
      `  </div>`,
    ].join('\n')
  }

  return [
    `<div style="${containerStyle}">`,
    `  <img src="${src}" alt="${alt}" style="${imgStyle}" />`,
    badgeMarkup,
    `</div>`,
  ].join('\n')
}

/**
 * Emits a single `<img>` tag with `width`, `height`, and `border-radius`
 * only. Badge + wrapper-dependent styling (padding, shadow, background)
 * are intentionally omitted — callers are expected to warn the user
 * when these settings are active.
 */
export function generateImgTag(tokenName: string, imageUrl: string, appearance: StudioAppearance): string {
  const { width, height, shape, borderRadius } = appearance
  const borderRadiusCSS = shapeToCSS(shape, borderRadius)

  return `<img src="${escapeHtmlAttribute(imageUrl)}" alt="${escapeHtmlAttribute(tokenName)}" width="${width}" height="${height}" style="border-radius: ${borderRadiusCSS}" />`
}
