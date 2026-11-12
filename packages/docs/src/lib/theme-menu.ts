/**
 * @module theme-menu
 * The parts of the theme menu that need no page: which choices exist, how a stored value is read,
 * and where the keyboard moves the highlight. The menu component wires these to the page.
 */

/** A theme choice. `auto` follows the system setting. */
export type ThemeChoice = 'auto' | 'light' | 'dark'

/** The choices in the order the menu lists them. */
export const THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark']

/** The `localStorage` key Starlight keeps the choice under. The menu must use the same key. */
export const THEME_STORAGE_KEY = 'starlight-theme'

/**
 * Read a stored value as a choice. Anything unknown, including no value, is `auto`.
 * Starlight stores an empty string for `auto`, so that case lands here too.
 */
export const parseThemeChoice = (value: unknown): ThemeChoice =>
  value === 'light' || value === 'dark' ? value : 'auto'

/** The value to store for a choice: Starlight stores nothing for `auto`. */
export const storedValueFor = (choice: ThemeChoice): string => (choice === 'auto' ? '' : choice)

/**
 * The theme the page shows for a choice.
 *
 * @param choice What the reader chose.
 * @param options.systemPrefersLight Whether the system asks for a light colour scheme.
 */
export const resolveTheme = (choice: ThemeChoice, options: { systemPrefersLight: boolean }): 'light' | 'dark' => {
  if (choice !== 'auto') return choice
  return options.systemPrefersLight ? 'light' : 'dark'
}

/** Keys that move the highlight inside an open menu. */
export type NavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

/** Whether a keyboard key name moves the highlight. */
export const isNavigationKey = (key: string): key is NavigationKey =>
  key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End'

/**
 * The item to highlight after a navigation key. Arrow keys wrap around at both ends.
 *
 * @param key The key pressed.
 * @param options.current Index of the highlighted item, or -1 when none is.
 * @param options.count How many items the menu has.
 */
export const nextItemIndex = (key: NavigationKey, options: { current: number; count: number }): number => {
  if (key === 'Home') return 0
  if (key === 'End') return options.count - 1
  const step = key === 'ArrowDown' ? 1 : -1
  if (options.current < 0) return step > 0 ? 0 : options.count - 1
  return (options.current + step + options.count) % options.count
}
