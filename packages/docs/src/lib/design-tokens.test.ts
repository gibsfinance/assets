import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { groupRoles, readColourRoles, readPalette, resolveValue } from './design-tokens.ts'

const palette = { 'color-gray-900': 'oklch(21% 0.034 264.665)', 'color-white': '#fff' }

const stylesheet = `
@theme inline {
  --color-content-strong: var(--ui-content-strong);
}

:root {
  /* Text */
  --ui-content-strong: var(--color-gray-900);
  --ui-content-fixed: #123456;
  /* Surfaces */
  --ui-surface: var(--color-white);
}

.dark {
  /* Text */
  --ui-content-strong: color-mix(in oklab, var(--color-white) 80%, transparent);
  --ui-surface: #09090b;
}
`

describe('readPalette', () => {
  it('reads colour properties and ignores everything else', () => {
    const themeCss = '@theme { --color-red-500: oklch(63% 0.2 25);\n  --color-white: #fff;\n  --font-sans: Inter; }'
    expect(readPalette(themeCss)).toEqual({ 'color-red-500': 'oklch(63% 0.2 25)', 'color-white': '#fff' })
  })
})

describe('resolveValue', () => {
  it('puts the palette value in place of each variable', () => {
    expect(resolveValue('color-mix(in oklab, var(--color-white) 80%, transparent)', palette)).toBe(
      'color-mix(in oklab, #fff 80%, transparent)',
    )
  })

  it('leaves a literal untouched', () => {
    expect(resolveValue('#123456', palette)).toBe('#123456')
  })

  it('names the entry it could not find', () => {
    expect(() => resolveValue('var(--color-missing)', palette)).toThrow('The palette has no --color-missing')
  })
})

describe('readColourRoles', () => {
  const roles = readColourRoles(stylesheet, palette)

  it('lists the roles in the order the stylesheet gives them', () => {
    expect(roles.map((role) => role.name)).toEqual(['content-strong', 'content-fixed', 'surface'])
  })

  it('reads the light value from :root and the dark value from .dark', () => {
    expect(roles[0]).toMatchObject({
      light: 'oklch(21% 0.034 264.665)',
      dark: 'color-mix(in oklab, #fff 80%, transparent)',
    })
  })

  it('gives a role with no dark value the same value in both themes', () => {
    expect(roles[1]).toMatchObject({ light: '#123456', dark: '#123456' })
  })

  it('takes the group from the comment above the role', () => {
    expect(roles.map((role) => role.group)).toEqual(['Text', 'Text', 'Surfaces'])
  })

  it('finds no roles in a stylesheet without a :root rule, and no dark values without a .dark rule', () => {
    expect(readColourRoles('a { color: red }', palette)).toEqual([])
    expect(readColourRoles(':root {\n  --ui-x: #fff;\n}\n', palette)[0]).toMatchObject({ dark: '#fff' })
  })
})

describe('groupRoles', () => {
  it('collects roles under their heading in order', () => {
    const grouped = groupRoles(readColourRoles(stylesheet, palette))
    expect(grouped.map((entry) => [entry.group, entry.roles.length])).toEqual([
      ['Text', 2],
      ['Surfaces', 1],
    ])
  })
})

describe('the real interface stylesheet', () => {
  const css = readFileSync(new URL('../../../ui/src/app.css', import.meta.url), 'utf8')
  const themeCss = readFileSync(new URL('../../../../node_modules/tailwindcss/theme.css', import.meta.url), 'utf8')
  const roles = readColourRoles(css, readPalette(themeCss))

  it('resolves every role to a colour in both themes', () => {
    expect(roles.length).toBeGreaterThan(50)
    for (const role of roles) {
      expect(role.light, role.name).not.toContain('var(')
      expect(role.dark, role.name).not.toContain('var(')
    }
  })

  it('gives every role a group heading', () => {
    for (const role of roles) expect(role.group, role.name).not.toBe('')
  })
})
