import { useState, useMemo, useCallback } from 'react'
import { useStudio } from '../contexts/StudioContext'
import { root } from '../config'
import { badgePositionToCSS } from '../utils/badge-position'
import CodeBlock from './CodeBlock'
import type { CodeFormat, CodeMode, StudioAppearance, BadgeConfig } from '../types'

// ---------------------------------------------------------------------------
// Shadow helpers
// ---------------------------------------------------------------------------

function shadowToCSS(shadow: StudioAppearance['shadow']): string {
  switch (shadow) {
    case 'subtle': return '0 1px 3px rgba(0,0,0,0.12)'
    case 'medium': return '0 4px 12px rgba(0,0,0,0.15)'
    case 'strong': return '0 8px 24px rgba(0,0,0,0.2)'
    default: return ''
  }
}

function shapeToCSS(
  shape: StudioAppearance['shape'],
  borderRadius: number,
): string {
  switch (shape) {
    case 'circle': return '50%'
    case 'rounded': return `${borderRadius}px`
    case 'square': return '0'
  }
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

function buildImageUrl(
  chainId: string,
  address: string,
  resolutionOrder: string[] | null,
  apiBase: string,
): string {
  if (resolutionOrder && resolutionOrder.length > 0) {
    return `${apiBase}/image/fallback/${resolutionOrder.join(',')}/${chainId}/${address}`
  }
  return `${apiBase}/image/${chainId}/${address}`
}

function buildNetworkUrl(chainId: string, apiBase: string): string {
  return `${apiBase}/image/${chainId}`
}

// ---------------------------------------------------------------------------
// Code generators
// ---------------------------------------------------------------------------

function generateSdkSnippet(
  chainId: string,
  address: string,
  appearance: StudioAppearance,
): string {
  const { width, shape } = appearance
  const shapeAttr = shape === 'rect' ? ' shape="rect"' : ''
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

function generateReactSnippet(
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

function generateReactComponent(
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

function generateHtmlSnippet(
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

function generateImgTag(
  tokenName: string,
  imageUrl: string,
  appearance: StudioAppearance,
): string {
  const { width, height, shape, borderRadius } = appearance
  const borderRadiusCSS = shapeToCSS(shape, borderRadius)

  return `<img src="${imageUrl}" alt="${tokenName}" width="${width}" height="${height}" style="border-radius: ${borderRadiusCSS}" />`
}

// ---------------------------------------------------------------------------
// Tab + mode controls
// ---------------------------------------------------------------------------

interface FormatTabsProps {
  value: CodeFormat
  onChange: (format: CodeFormat) => void
}

function FormatTabs({ value, onChange }: FormatTabsProps) {
  const tabs: { label: string; value: CodeFormat }[] = [
    { label: 'SDK', value: 'sdk' },
    { label: 'React', value: 'react' },
    { label: 'HTML', value: 'html' },
    { label: '<img>', value: 'img' },
  ]

  return (
    <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-surface-2">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
            value === tab.value
              ? 'bg-white text-gray-900 shadow-sm dark:bg-surface-3 dark:text-white'
              : 'text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/70'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

interface ModeSwitchProps {
  value: CodeMode
  onChange: (mode: CodeMode) => void
  disabled: boolean
}

function ModeSwitch({ value, onChange, disabled }: ModeSwitchProps) {
  return (
    <div className={`flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-surface-2 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {(['snippet', 'component'] as CodeMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          disabled={disabled}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-all ${
            value === mode
              ? 'bg-white text-gray-900 shadow-sm dark:bg-surface-3 dark:text-white'
              : 'text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/70'
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Copy button with feedback
// ---------------------------------------------------------------------------

interface CopyButtonProps {
  text: string
  label: string
  variant?: 'primary' | 'secondary'
}

function CopyButton({ text, label, variant = 'primary' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available — silently ignore
    }
  }, [text])

  const baseClass =
    variant === 'primary'
      ? 'rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-accent-400 disabled:opacity-50'
      : 'rounded-lg border border-border-light bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:border-border-dark dark:bg-surface-2 dark:text-white/70 dark:hover:bg-surface-3 dark:hover:text-white'

  return (
    <button type="button" onClick={handleCopy} className={baseClass}>
      {copied ? (
        <>
          <i className="fas fa-check mr-2 text-xs" />
          Copied!
        </>
      ) : (
        <>
          <i className="fas fa-copy mr-2 text-xs" />
          {label}
        </>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * CodeOutput — generates copy-ready React / HTML / img code from StudioContext state.
 *
 * Reads all configuration from `useStudio()` — no props required.
 */
export default function CodeOutput() {
  const {
    selectedToken,
    selectedChainId,
    appearance,
    badge,
    codeFormat,
    codeMode,
    resolutionOrder,
    setCodeFormat,
    setCodeMode,
  } = useStudio()

  const apiBase = root ?? ''

  const imageUrl = useMemo(() => {
    if (!selectedToken || !selectedChainId) return `${apiBase}/image/1/0x0000000000000000000000000000000000000000`
    return buildImageUrl(
      selectedChainId,
      selectedToken.address,
      resolutionOrder,
      apiBase,
    )
  }, [selectedToken, selectedChainId, resolutionOrder, apiBase])

  const networkUrl = useMemo(
    () => buildNetworkUrl(selectedChainId ?? '1', apiBase),
    [selectedChainId, apiBase],
  )

  const tokenName = selectedToken?.name ?? 'Token'

  const generatedCode = useMemo(() => {
    switch (codeFormat) {
      case 'sdk':
        return generateSdkSnippet(
          selectedChainId ?? '1',
          selectedToken?.address ?? '0x0000000000000000000000000000000000000000',
          appearance,
        )

      case 'react':
        return codeMode === 'component'
          ? generateReactComponent(tokenName, imageUrl, networkUrl, appearance, badge)
          : generateReactSnippet(tokenName, imageUrl, networkUrl, appearance, badge)

      case 'html':
        return generateHtmlSnippet(tokenName, imageUrl, networkUrl, appearance, badge)

      case 'img':
        return generateImgTag(tokenName, imageUrl, appearance)
    }
  }, [codeFormat, codeMode, tokenName, imageUrl, networkUrl, appearance, badge, selectedChainId, selectedToken])

  // `component` mode only applies to React — disable the mode switch for other formats
  const isModeDisabled = codeFormat !== 'react'

  const showBadgeWarning = codeFormat === 'img' && badge.enabled

  // Map format to a Shiki language that produces good highlighting
  const codeLanguage = codeFormat === 'html' ? 'html' : 'js'

  return (
    <div className="flex flex-col gap-4">
      {/* Controls row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FormatTabs value={codeFormat} onChange={setCodeFormat} />
        <ModeSwitch value={codeMode} onChange={setCodeMode} disabled={isModeDisabled} />
      </div>

      {/* Badge + img warning */}
      {showBadgeWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-50 px-4 py-3 text-sm text-yellow-700 dark:bg-yellow-500/5 dark:text-yellow-400">
          <i className="fas fa-triangle-exclamation mt-0.5 flex-shrink-0" />
          <span>
            Badge requires a wrapper element — switch to <strong>React</strong> or{' '}
            <strong>HTML</strong> for badge support.
          </span>
        </div>
      )}

      {/* Code block */}
      <div className="overflow-hidden rounded-lg border border-border-light dark:border-border-dark">
        <CodeBlock
          code={generatedCode}
          lang={codeLanguage}
          base="overflow-x-auto"
          rounded=""
          prePadding="[&>pre]:px-4 [&>pre]:py-4 [&>pre]:w-fit"
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <CopyButton text={generatedCode} label="Copy Code" variant="primary" />
        <CopyButton text={imageUrl} label="Copy URL" variant="secondary" />
      </div>
    </div>
  )
}
