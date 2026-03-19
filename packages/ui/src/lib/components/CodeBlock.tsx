import { useMemo } from 'react'
import { createHighlighterCoreSync } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import themeDarkPlus from 'shiki/themes/dark-plus.mjs'
import themeLightPlus from 'shiki/themes/light-plus.mjs'
import console from 'shiki/langs/console.mjs'
import html from 'shiki/langs/html.mjs'
import css from 'shiki/langs/css.mjs'
import js from 'shiki/langs/javascript.mjs'
import type { CodeBlockProps } from '../types'
import { useTheme } from '../contexts/ThemeContext'

const shiki = createHighlighterCoreSync({
  engine: createJavaScriptRegexEngine(),
  themes: [themeDarkPlus, themeLightPlus],
  langs: [console, html, css, js],
})

export default function CodeBlock({
  code = '',
  lang = 'console',
  theme: themeInput,
  base = 'overflow-x-auto',
  rounded = 'rounded-container',
  shadow = '',
  classes = '',
  preBase = '',
  prePadding = '[&>pre]:px-4 [&>pre]:py-2 [&>pre]:w-fit',
  preClasses = '',
}: CodeBlockProps) {
  const { isDark } = useTheme()

  const theme = useMemo(
    () => (themeInput || isDark ? 'dark-plus' : 'light-plus'),
    [themeInput, isDark],
  )

  // Shiki generates sanitized HTML from code syntax highlighting.
  // This is equivalent to Svelte's {@html generatedHtml} in the original component.
  const generatedHtml = useMemo(
    () => shiki.codeToHtml(code, { lang, theme }),
    [code, lang, theme],
  )

  return (
    <div
      className={`${base} ${rounded} ${shadow} ${classes} ${preBase} ${prePadding} ${preClasses}`}
      dangerouslySetInnerHTML={{ __html: generatedHtml }}
    />
  )
}
