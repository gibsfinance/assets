/**
 * @module design-tokens
 * Reads the colour roles out of the interface stylesheet, so the design language page shows
 * the values the interface really uses and never a copy that can drift.
 *
 * The stylesheet (`packages/ui/src/app.css`) defines each role as a custom property named
 * `--ui-<role>`: the light value is under `:root` and the dark value is under `.dark`. A role
 * with no dark value is the same in both themes. Values refer to Tailwind's own palette
 * (`var(--color-gray-900)`), so they are resolved here against Tailwind's `theme.css`.
 */

/** One colour role, with the value it takes in each theme. */
export interface ColourRole {
  /** The role name, for example `content-muted`. The utility class is built from it, such as `text-content-muted`. */
  name: string
  /** The group heading from the comment above the role. */
  group: string
  /** The light theme value, as CSS a browser can draw. */
  light: string
  /** The dark theme value, as CSS a browser can draw. */
  dark: string
}

/**
 * Read every `--color-*` custom property of a stylesheet.
 *
 * @param themeCss The text of Tailwind's `theme.css`.
 * @returns The properties by name, without the leading `--`.
 */
export function readPalette(themeCss: string): Record<string, string> {
  const palette: Record<string, string> = {}
  for (const [, name, value] of themeCss.matchAll(/--(color-[a-z0-9-]+):\s*([^;]+);/g)) {
    palette[name] = value.trim()
  }
  return palette
}

/**
 * Replace each `var(--color-x)` in a value with the palette's value for it.
 *
 * @param value A custom property value.
 * @param palette The palette from {@link readPalette}.
 * @throws When the value names a palette entry that does not exist.
 */
export function resolveValue(value: string, palette: Record<string, string>): string {
  return value.replace(/var\(--(color-[a-z0-9-]+)\)/g, (_match, name: string) => {
    const resolved = palette[name]
    if (resolved === undefined) throw new Error(`The palette has no --${name}`)
    return resolved
  })
}

/**
 * The body of the first rule whose selector is exactly `selector`.
 *
 * @param css The stylesheet text.
 * @param selector For example `:root` or `.dark`.
 * @returns The text between the braces, or an empty string when there is no such rule.
 */
function ruleBody(css: string, selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{`, 'm'))
  if (start === -1) return ''
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('\n}', open))
}

/** One role definition found in a rule body, with the group heading above it. */
interface Definition {
  name: string
  value: string
  group: string
}

/** Read `--ui-*` definitions in order, tracking the last comment as the group heading. */
function readDefinitions(body: string): Definition[] {
  const definitions: Definition[] = []
  let group = ''
  for (const [, heading, name, value] of body.matchAll(/\/\*\s*([^*]+?)\s*\*\/|--ui-([a-z0-9-]+):\s*([^;]+);/g)) {
    if (heading !== undefined) group = heading
    else definitions.push({ name, value: value.trim(), group })
  }
  return definitions
}

/**
 * Build the list of colour roles from the interface stylesheet.
 *
 * @param css The text of `packages/ui/src/app.css`.
 * @param palette Tailwind's palette, from {@link readPalette}.
 * @returns The roles in the order the stylesheet lists them.
 */
export function readColourRoles(css: string, palette: Record<string, string>): ColourRole[] {
  const darkValues = new Map(readDefinitions(ruleBody(css, '.dark')).map(({ name, value }) => [name, value]))
  return readDefinitions(ruleBody(css, ':root')).map(({ name, value, group }) => ({
    name,
    group,
    light: resolveValue(value, palette),
    dark: resolveValue(darkValues.get(name) ?? value, palette),
  }))
}

/**
 * Collect roles under their group heading, keeping the stylesheet's order.
 *
 * @param roles The roles from {@link readColourRoles}.
 */
export function groupRoles(roles: readonly ColourRole[]): { group: string; roles: ColourRole[] }[] {
  const groups = new Map<string, ColourRole[]>()
  for (const role of roles) groups.set(role.group, [...(groups.get(role.group) ?? []), role])
  return [...groups].map(([group, members]) => ({ group, roles: members }))
}
