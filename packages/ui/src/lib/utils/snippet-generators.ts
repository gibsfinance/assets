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
 * NOTE: These generators MUST remain byte-for-byte identical to the
 * original implementations — the production UI reads them verbatim.
 */
import type { StudioAppearance, BadgeConfig } from '../types'
import { badgePositionToCSS } from './badge-position'
import { shadowToCSS, shapeToCSS } from './code-output'

/**
 * Emits a `@gibs/react` SDK usage snippet (GibProvider + TokenImage).
 *
 * @param chainId    - Numeric chain id as a string (e.g. `'1'`, `'369'`)
 * @param address    - Token contract address (already validated upstream)
 * @param appearance - Studio appearance config; only `width` and `shape` are read
 */
export function generateSdkSnippet(
  chainId: string,
  address: string,
  appearance: StudioAppearance,
): string {
  const { width, shape } = appearance
  const shapeAttr = shape === 'square' ? ' shape="square"' : ''
  return [
    `import { GibProvider, TokenImage } from '@gibs/react'`,
    ``,
    `<GibProvider>`,
    `  <TokenImage`,
    `    chainId={${chainId}}`,
    `    address="${address}"`,
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

  const imgStyleParts: string[] = [
    `width: ${width}`,
    `height: ${height}`,
    `borderRadius: '${borderRadiusCSS}'`,
  ]

  const wrapperStyleParts: string[] = [
    `borderRadius: '${borderRadiusCSS}'`,
  ]
  if (padding > 0) wrapperStyleParts.push(`padding: ${padding}`)
  if (shadowCSS) wrapperStyleParts.push(`boxShadow: '${shadowCSS}'`)
  if (backgroundColor !== 'transparent') wrapperStyleParts.push(`backgroundColor: '${backgroundColor}'`)

  const imgStyle = `{ ${imgStyleParts.join(', ')} }`
  const needsWrapper = badge.enabled || padding > 0 || shadowCSS || backgroundColor !== 'transparent'

  if (!needsWrapper) {
    return `<img\n  src="${imageUrl}"\n  alt="${tokenName}"\n  style={${imgStyle}}\n/>`
  }

  if (!badge.enabled) {
    const wrapperStyle = `{ display: 'inline-block', ${wrapperStyleParts.join(', ')} }`
    return [
      `<div style={${wrapperStyle}}>`,
      `  <img src="${imageUrl}" alt="${tokenName}" style={${imgStyle}} />`,
      `</div>`,
    ].join('\n')
  }

  const { top, left, badgeSize } = badgePositionToCSS(
    paddedWidth,
    badge.angleDeg,
    badge.sizeRatio,
    badge.overlap,
  )

  const ringOffset = badge.ringEnabled ? badge.ringThickness : 0
  const badgeStyleParts = [
    'position: \'absolute\'',
    `top: ${Math.round(top) - ringOffset}`,
    `left: ${Math.round(left) - ringOffset}`,
    `width: ${Math.round(badgeSize)}`,
    `height: ${Math.round(badgeSize)}`,
    "borderRadius: '50%'",
  ]
  if (badge.ringEnabled) {
    badgeStyleParts.push(`border: '${badge.ringThickness}px solid ${badge.ringColor}'`)
  }

  const badgeStyle = `{ ${badgeStyleParts.join(', ')} }`
  const containerStyle = `{ position: 'relative', display: 'inline-block', width: ${paddedWidth}, height: ${paddedHeight}, ${wrapperStyleParts.join(', ')} }`

  return [
    `<div style={${containerStyle}}>`,
    `  <img`,
    `    src="${imageUrl}"`,
    `    alt="${tokenName}"`,
    `    style={${imgStyle}}`,
    `  />`,
    `  <img`,
    `    src="${networkUrl}"`,
    `    alt="Network"`,
    `    style={${badgeStyle}}`,
    `  />`,
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
    `  src="${imageUrl}"`,
    `  alt={alt}`,
    `  width={size}`,
    `  height={size}`,
    `  style={{`,
    `    width: size,`,
    `    height: size,`,
    `    borderRadius: '${borderRadiusCSS}',${shadowStyle}`,
    `  }}`,
    `/>`,
  ].map((line) => `${imgIndent}${line}`).join('\n')

  const badgeImgLines = badge.enabled
    ? [
      `      <img`,
      `        src="${networkUrl}"`,
      `        alt="Network"`,
      `        style={{`,
      `          position: 'absolute',`,
      `          top: badgeTop,`,
      `          left: badgeLeft,`,
      `          width: badgeSize,`,
      `          height: badgeSize,`,
      `          borderRadius: '50%',`,
      badge.ringEnabled
        ? `          border: '${badge.ringThickness}px solid ${badge.ringColor}',`
        : '',
      `        }}`,
      `      />`,
    ].filter(Boolean).join('\n')
    : ''

  const badgeConditional = badge.enabled
    ? `\n      {badge && (\n${badgeImgLines}\n      )}`
    : ''

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
    `  src = '${imageUrl}',`,
    `  alt = '${tokenName}',`,
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

  const imgStyleParts = [
    `width: ${width}px`,
    `height: ${height}px`,
    `border-radius: ${borderRadiusCSS}`,
  ]
  const imgStyle = imgStyleParts.join('; ')

  const wrapperStyleParts = [
    `border-radius: ${borderRadiusCSS}`,
  ]
  if (padding > 0) wrapperStyleParts.push(`padding: ${padding}px`)
  if (shadowCSS) wrapperStyleParts.push(`box-shadow: ${shadowCSS}`)
  if (backgroundColor !== 'transparent') wrapperStyleParts.push(`background: ${backgroundColor}`)

  const needsWrapper = badge.enabled || padding > 0 || shadowCSS || backgroundColor !== 'transparent'

  if (!needsWrapper) {
    return `<img src="${imageUrl}" alt="${tokenName}" style="${imgStyle}" />`
  }

  if (!badge.enabled) {
    const wrapperStyle = `display: inline-block; ${wrapperStyleParts.join('; ')}`
    return [
      `<div style="${wrapperStyle}">`,
      `  <img src="${imageUrl}" alt="${tokenName}" style="${imgStyle}" />`,
      `</div>`,
    ].join('\n')
  }

  const { top, left, badgeSize } = badgePositionToCSS(
    paddedWidth,
    badge.angleDeg,
    badge.sizeRatio,
    badge.overlap,
  )

  const htmlRingOffset = badge.ringEnabled ? badge.ringThickness : 0
  const badgeStyleParts = [
    'position: absolute',
    `top: ${Math.round(top) - htmlRingOffset}px`,
    `left: ${Math.round(left) - htmlRingOffset}px`,
    `width: ${Math.round(badgeSize)}px`,
    `height: ${Math.round(badgeSize)}px`,
    'border-radius: 50%',
  ]
  if (badge.ringEnabled) {
    badgeStyleParts.push(`border: ${badge.ringThickness}px solid ${badge.ringColor}`)
  }

  const badgeStyle = badgeStyleParts.join('; ')
  const containerStyle = `position: relative; display: inline-block; width: ${paddedWidth}px; height: ${paddedHeight}px; ${wrapperStyleParts.join('; ')}`

  return [
    `<div style="${containerStyle}">`,
    `  <img src="${imageUrl}" alt="${tokenName}" style="${imgStyle}" />`,
    `  <img src="${networkUrl}" alt="Network" style="${badgeStyle}" />`,
    `</div>`,
  ].join('\n')
}

/**
 * Emits a single `<img>` tag with `width`, `height`, and `border-radius`
 * only. Badge + wrapper-dependent styling (padding, shadow, background)
 * are intentionally omitted — callers are expected to warn the user
 * when these settings are active.
 */
export function generateImgTag(
  tokenName: string,
  imageUrl: string,
  appearance: StudioAppearance,
): string {
  const { width, height, shape, borderRadius } = appearance
  const borderRadiusCSS = shapeToCSS(shape, borderRadius)

  return `<img src="${imageUrl}" alt="${tokenName}" width="${width}" height="${height}" style="border-radius: ${borderRadiusCSS}" />`
}
