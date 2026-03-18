<!-- @component Code Block based on: https://shiki.style/ -->

<script module>
  import { createHighlighterCoreSync } from 'shiki/core'
  import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
  // Themes
  // https://shiki.style/themes
  import themeDarkPlus from 'shiki/themes/dark-plus.mjs'
  import themeLightPlus from 'shiki/themes/light-plus.mjs'
  // Languages
  // https://shiki.style/languages
  import console from 'shiki/langs/console.mjs'
  import html from 'shiki/langs/html.mjs'
  import css from 'shiki/langs/css.mjs'
  import js from 'shiki/langs/javascript.mjs'

  // https://shiki.style/guide/sync-usage
  const shiki = createHighlighterCoreSync({
    engine: createJavaScriptRegexEngine(),
    // Implement your import theme.
    themes: [themeDarkPlus, themeLightPlus],
    // Implement your imported and supported languages.
    langs: [console, html, css, js],
  })
</script>

<script lang="ts">
  import type { CodeBlockProps } from '../types'
  import { isDark } from '../stores/theme'

  let {
    code = '',
    lang = 'console',
    theme: themeInput,
    // Base Style Props
    base = 'overflow-x-auto',
    rounded = 'rounded-container',
    shadow = '',
    classes = '',
    // Pre Style Props
    preBase = '',
    prePadding = '[&>pre]:px-4 [&>pre]:py-2 [&>pre]:w-fit',
    preClasses = '',
  }: CodeBlockProps = $props()

  const theme = $derived(themeInput || $isDark ? 'dark-plus' : 'light-plus')

  // Shiki convert to HTML
  const generatedHtml = $derived(shiki.codeToHtml(code, { lang, theme }))
</script>

<div class="{base} {rounded} {shadow} {classes} {preBase} {prePadding} {preClasses}">
  <!-- Output Shiki's Generated HTML -->
  {@html generatedHtml}
</div>
