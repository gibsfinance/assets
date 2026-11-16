/**
 * @module tab-keys
 * Keyboard movement through a row of tabs, as the WAI-ARIA tabs pattern describes it.
 */

/**
 * The tab that a key press moves to, or null when the key does not move between tabs.
 *
 * Right and Left step one tab and wrap at the ends. Home goes to the first tab and End to the last.
 *
 * @param input.current The index of the tab that has focus now.
 * @param input.key The key the reader pressed, as the browser names it.
 * @param input.count How many tabs there are.
 * @returns The index to move to, or null for a key the tabs do not use.
 */
export function nextTabIndex({ current, key, count }: { current: number; key: string; count: number }): number | null {
  if (key === 'ArrowRight') return (current + 1) % count
  if (key === 'ArrowLeft') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}
