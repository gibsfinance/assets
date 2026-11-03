import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { HighlighterCore } from 'shiki/core'
import type { CodeBlockProps } from '../types'
import { useTheme } from '../contexts/ThemeContext'
import { useNearView } from '../hooks/useNearView'
import { scheduleIdle } from '../utils/idle'

// Shiki (engine + grammars + themes) is several hundred kilobytes — far too
// heavy for the landing chunk. A block starts the load only when it is near
// the viewport, in idle time. All blocks share one load and subscribe to its
// result; until it arrives, each renders the same text in a plain <pre> with
// matching padding so nothing shifts when highlighting lands.
let highlighter: HighlighterCore | null = null
let loadPromise: Promise<void> | null = null
const subscribers = new Set<() => void>()

function loadHighlighter(): Promise<void> {
  loadPromise ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('shiki/themes/dark-plus.mjs'),
    import('shiki/themes/light-plus.mjs'),
    import('shiki/langs/console.mjs'),
    import('shiki/langs/html.mjs'),
    import('shiki/langs/css.mjs'),
    import('shiki/langs/javascript.mjs'),
  ]).then(([core, engine, darkPlus, lightPlus, consoleLang, html, css, js]) => {
    highlighter = core.createHighlighterCoreSync({
      engine: engine.createJavaScriptRegexEngine(),
      themes: [darkPlus.default, lightPlus.default],
      langs: [consoleLang.default, html.default, css.default, js.default],
    })
    subscribers.forEach((notify) => notify())
  })
  return loadPromise
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify)
  return () => subscribers.delete(notify)
}

const getSnapshot = () => highlighter
const getServerSnapshot = () => null

export default function CodeBlock({
  code = '',
  lang = 'console',
  theme: themeInput,
  base = 'overflow-x-auto font-mono',
  rounded = 'rounded-lg',
  shadow = '',
  classes = 'bg-surface-light-2 dark:bg-surface-1',
  preBase = '',
  prePadding = '[&>pre]:px-4 [&>pre]:py-2 [&>pre]:w-fit',
  preClasses = '',
}: CodeBlockProps) {
  const { isDark } = useTheme()
  const wrapperReference = useRef<HTMLDivElement>(null)
  const isNear = useNearView(wrapperReference)
  const shiki = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    if (!isNear) return
    return scheduleIdle(() => void loadHighlighter())
  }, [isNear])

  const theme = useMemo(() => (themeInput || isDark ? 'dark-plus' : 'light-plus'), [themeInput, isDark])

  // Shiki generates sanitized HTML from code syntax highlighting.
  // This is equivalent to Svelte's {@html generatedHtml} in the original component.
  const generatedHtml = useMemo(
    () => (shiki ? shiki.codeToHtml(code, { lang, theme }) : null),
    [shiki, code, lang, theme],
  )

  const wrapperClass = `${base} ${rounded} ${shadow} ${classes} ${preBase} ${prePadding} ${preClasses}`

  if (!generatedHtml) {
    return (
      <div ref={wrapperReference} className={wrapperClass}>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  return <div ref={wrapperReference} className={wrapperClass} dangerouslySetInnerHTML={{ __html: generatedHtml }} />
}
