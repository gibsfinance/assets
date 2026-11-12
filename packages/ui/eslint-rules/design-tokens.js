/**
 * @module design-tokens
 * Lint support for the design token rule: name a colour by its ROLE, never by its value.
 *
 * A name that carries a value ("cyan", "gray-400", "dark") turns false the moment a theme
 * changes that value. The interface therefore uses role classes (`text-content-muted`,
 * `bg-surface-raised`) that follow the theme through custom properties, and never a raw
 * palette class. The rule and the reasons are on the design language page of the
 * documentation site (`design/design-language` in `packages/docs`).
 *
 * This file is plain JavaScript because ESLint loads it directly. Its types are in
 * `design-tokens.d.ts`, and its tests are in `src/design-tokens.test.ts`.
 */

/** Tailwind's colour families. Each one names a hue. */
export const PALETTE_HUES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
]

/** Words that name a theme mode. A token is one value that switches, so it never names a mode. */
export const MODE_WORDS = ['light', 'dark']

/** The utility prefixes that take a colour. */
const COLOUR_UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'from',
  'to',
  'via',
  'fill',
  'stroke',
  'shadow',
  'outline',
  'divide',
  'placeholder',
  'decoration',
  'accent',
  'caret',
]

const RAW_PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:[a-z-]+(?:\\[[^\\]]*\\])?:)*(?:${COLOUR_UTILITIES.join('|')})-(?:${PALETTE_HUES.join('|')})-\\d{2,3}(?:/(?:\\d+|\\[[\\d.]+\\]))?(?![\\w-])`,
  'g',
)

/**
 * Find every raw palette class in a piece of text, such as `text-gray-400` or
 * `dark:hover:bg-red-900/20`. `white`, `black`, `transparent` and `current` are not
 * palette hues and are not reported.
 *
 * @param {string} text Any text, usually the value of a string literal.
 * @returns {string[]} The classes found, in order.
 */
export const findRawPaletteClasses = (text) => text.match(RAW_PALETTE_CLASS) ?? []

/** A custom property or class name, split into the words between its hyphens. */
const wordsOf = (name) => name.split('-').filter(Boolean)

/**
 * Say why a token name breaks the rule, or `null` when it is a good name. A name breaks the
 * rule when a word in it is a hue, a mode, or a bare scale number such as `500`.
 *
 * @param {string} name A token name without its `--color-` style prefix, for example `accent-secondary`.
 * @returns {string | null} The reason, or `null`.
 */
export const explainBadTokenName = (name) => {
  const words = wordsOf(name)
  const hue = words.find((word) => PALETTE_HUES.includes(word))
  if (hue) return `"${hue}" names a hue`
  const mode = words.find((word) => MODE_WORDS.includes(word))
  if (mode) return `"${mode}" names a theme mode`
  const scale = words.find((word) => /^\d{3,}$/.test(word))
  if (scale) return `"${scale}" is a value from a colour scale`
  return null
}

/**
 * Check every custom property a stylesheet defines under a colour or shadow namespace.
 *
 * @param {string} css The stylesheet text.
 * @returns {{ name: string, reason: string }[]} One entry per property whose name breaks the rule.
 */
export const findBadTokenNames = (css) => {
  const definitions = css.matchAll(/(--(?:color|shadow|ui)-([a-z0-9-]+))\s*:/g)
  const problems = []
  for (const [, name, bare] of definitions) {
    const reason = explainBadTokenName(bare)
    if (reason) problems.push({ name, reason })
  }
  return problems
}

/**
 * The message shown for a raw palette class.
 *
 * @param {string} className The class that was found.
 */
export const rawPaletteMessage = (className) =>
  `Raw palette class "${className}". Use a role token such as text-content-muted or bg-surface-raised, which follows the theme. See design/design-language in packages/docs.`

/** ESLint rule: no raw palette classes in string literals or template text. */
export const noRawPaletteClasses = {
  meta: { type: 'problem', schema: [], messages: { raw: '{{ message }}' } },
  create(context) {
    const check = (node, text) => {
      for (const className of findRawPaletteClasses(text)) {
        context.report({ node, messageId: 'raw', data: { message: rawPaletteMessage(className) } })
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw)
      },
    }
  },
}

/** The plugin object for `eslint.config.js`. */
export default { rules: { 'no-raw-palette-classes': noRawPaletteClasses } }
