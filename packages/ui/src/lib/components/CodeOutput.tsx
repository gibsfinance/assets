import { useState, useMemo, useCallback } from 'react'
import { useStudio } from '../contexts/StudioContext'
import { root } from '../config'
import CodeBlock from './CodeBlock'
import type { CodeFormat, CodeMode } from '../types'
import { buildImageUrl, buildNetworkUrl } from '../utils/code-output'
import {
  generateSdkSnippet,
  generateReactSnippet,
  generateReactComponent,
  generateHtmlSnippet,
  generateImgTag,
} from '../utils/snippet-generators'

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
        {!isModeDisabled && (
          <ModeSwitch value={codeMode} onChange={setCodeMode} disabled={false} />
        )}
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
