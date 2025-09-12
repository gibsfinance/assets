import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'

// Register languages
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('xml', xml)

export function highlightCode(code: string, language?: string) {
  if (language) {
    return hljs.highlight(code, { language }).value
  }
  return hljs.highlightAuto(code).value
}

export function highlightElement(element: HTMLElement) {
  hljs.highlightElement(element)
}

export { hljs }
