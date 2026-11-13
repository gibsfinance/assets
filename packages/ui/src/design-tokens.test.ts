// @vitest-environment node
/* eslint-disable design/no-raw-palette-classes -- this file holds raw palette classes on purpose, as the rule's examples */
import { readFileSync } from 'node:fs'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import designTokens, {
  explainBadTokenName,
  findBadTokenNames,
  findRawPaletteClasses,
  rawPaletteMessage,
} from '../eslint-rules/design-tokens.js'

const stylesheet = readFileSync(new URL('./app.css', import.meta.url), 'utf8')

describe('findRawPaletteClasses', () => {
  it.each([
    ['text-gray-400', ['text-gray-400']],
    ['dark:hover:bg-red-900/20', ['dark:hover:bg-red-900/20']],
    ['from-cyan-500 to-purple-600', ['from-cyan-500', 'to-purple-600']],
    ['placeholder:text-slate-300', ['placeholder:text-slate-300']],
    ['data-[open]:ring-green-500/[0.4]', ['data-[open]:ring-green-500/[0.4]']],
    ['hover:border-amber-50', ['hover:border-amber-50']],
  ])('finds the raw classes in %s', (text, expected) => {
    expect(findRawPaletteClasses(text)).toEqual(expected)
  })

  it.each([
    'text-content-muted',
    'bg-surface-raised',
    'border-border',
    'bg-accent/10',
    'text-white',
    'bg-black/60',
    'bg-transparent',
    'text-current',
    'text-gray',
    'my-text-gray-400',
    'text-grayish-400',
    'text-gray-4000',
    'bg-accent-secondary',
  ])('allows %s', (text) => {
    expect(findRawPaletteClasses(text)).toEqual([])
  })
})

describe('explainBadTokenName', () => {
  it.each([
    ['cyan-500', '"cyan" names a hue'],
    ['glow-green', '"green" names a hue'],
    ['surface-light-2', '"light" names a theme mode'],
    ['border-dark', '"dark" names a theme mode'],
    ['accent-500', '"500" is a value from a colour scale'],
  ])('rejects %s', (name, reason) => {
    expect(explainBadTokenName(name)).toBe(reason)
  })

  it.each(['accent', 'accent-secondary', 'content-secondary', 'surface-raised', 'border-strong', 'danger-soft'])(
    'accepts %s',
    (name) => {
      expect(explainBadTokenName(name)).toBeNull()
    },
  )
})

describe('findBadTokenNames', () => {
  it('reports each colour, shadow and role property whose name breaks the rule', () => {
    const css = `
      :root { --color-cyan-500: #0ea5e9; --shadow-glow-green: none; --ui-surface-light-1: #fff; }
      .dark { --color-accent: red; --font-heading: serif; --other-gray-500: 1; }
    `
    expect(findBadTokenNames(css)).toEqual([
      { name: '--color-cyan-500', reason: '"cyan" names a hue' },
      { name: '--shadow-glow-green', reason: '"green" names a hue' },
      { name: '--ui-surface-light-1', reason: '"light" names a theme mode' },
    ])
  })
})

describe('app.css', () => {
  it('names every token by its role', () => {
    expect(findBadTokenNames(stylesheet)).toEqual([])
  })

  it('defines the tokens it checks', () => {
    // A check that finds nothing to examine passes for the wrong reason.
    expect(stylesheet.match(/--ui-[a-z0-9-]+:/g)?.length).toBeGreaterThan(50)
  })

  it('gives every role a dark value or the same value in both themes, never a stray dark entry', () => {
    const lightNames = new Set([...stylesheet.split('.dark {')[0].matchAll(/--ui-([a-z0-9-]+):/g)].map((m) => m[1]))
    const darkBlock = stylesheet.split('.dark {')[1].split('\n}')[0]
    for (const [, name] of darkBlock.matchAll(/--ui-([a-z0-9-]+):/g)) {
      expect(lightNames.has(name), name).toBe(true)
    }
  })

  it('has no role whose name ends in a number', () => {
    // A numbered role is a near duplicate of another. Fold it into the role that does its job.
    const roles = [...stylesheet.matchAll(/--ui-([a-z0-9-]+):/g)].map((m) => m[1])
    expect(roles.filter((role) => /-\d+$/.test(role))).toEqual([])
  })

  it('exposes every role to Tailwind', () => {
    const roles = [...stylesheet.split('.dark {')[0].matchAll(/--ui-([a-z0-9-]+):/g)].map((m) => m[1])
    for (const role of roles) expect(stylesheet, role).toContain(`--color-${role}: var(--ui-${role});`)
  })
})

describe('the design/no-raw-palette-classes rule', () => {
  const lint = (code: string) => {
    const linter = new Linter()
    return linter.verify(
      code,
      [
        {
          files: ['**/*.tsx'],
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
          plugins: { design: designTokens },
          rules: { 'design/no-raw-palette-classes': 'error' },
        },
      ],
      'example.tsx',
    )
  }

  it('reports a raw palette class in a string, with a message that points at the design language page', () => {
    const [problem] = lint('const a = "p-2 text-gray-400"')
    expect(problem.message).toBe(rawPaletteMessage('text-gray-400'))
    expect(problem.message).toContain('design/design-language')
  })

  it('reports a raw palette class in a JSX attribute and in template text', () => {
    expect(lint('const a = <p className="bg-red-50" />')).toHaveLength(1)
    expect(lint('const a = `rounded ${x} dark:text-green-400`')).toHaveLength(1)
  })

  it('reports every raw class in one string', () => {
    expect(lint('const a = "bg-gray-50 dark:bg-red-900/20"')).toHaveLength(2)
  })

  it('lets role classes, white, black and non-string values through', () => {
    expect(lint('const a = "text-content-muted bg-surface-raised text-white bg-black/60"')).toEqual([])
    expect(lint('const a = [1, null, `plain`]')).toEqual([])
  })
})

describe('accent text contrast', () => {
  const light = stylesheet.split('.dark {')[0]
  const dark = stylesheet.split('.dark {')[1].split('\n}')[0]
  const hexOf = (block: string, role: string) => block.match(new RegExp(`--ui-${role}: (#[0-9a-f]{6});`))?.[1] as string
  const channel = (value: number) => {
    const unit = value / 255
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  }
  const luminance = (hex: string) => {
    const [red, green, blue] = [1, 3, 5].map((start) => channel(parseInt(hex.slice(start, start + 2), 16)))
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const contrast = (first: string, second: string) => {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
    return (lighter + 0.05) / (darker + 0.05)
  }
  // The accent at 15 percent over white, the strongest tint a control puts behind accent text.
  const lightBackgrounds = ['#ffffff', '#f9fafb', '#d9faec']
  const darkBackgrounds = ['#09090b', '#111113', '#1a1a1e']

  it.each(['accent-content', 'accent-content-hover', 'accent-secondary-content'])(
    '%s reaches 4.5 to 1 on every light and dark background it sits on',
    (role) => {
      for (const background of lightBackgrounds) {
        expect(contrast(hexOf(light, role), background), `${role} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const background of darkBackgrounds) {
        expect(contrast(hexOf(dark, role), background), `${role} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    },
  )

  it('fails for the raw accent on white, so the check can tell a bad colour from a good one', () => {
    expect(contrast(hexOf(light, 'accent'), '#ffffff')).toBeLessThan(2)
  })
})
