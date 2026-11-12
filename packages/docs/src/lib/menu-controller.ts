/**
 * @module menu-controller
 * The keyboard and pointer behaviour of a menu button, following the WAI-ARIA menu button
 * pattern. Every menu on this site uses it, so the rules live in one place: the theme menu,
 * and the menus that replace the native selects in the endpoint reference.
 */
import { isNavigationKey, nextItemIndex } from './theme-menu.ts'

/** What a menu needs from the page. */
export interface MenuOptions {
  /** The element that holds the button and the list. It receives `data-placement`. */
  host: HTMLElement
  /** The button that opens the menu. */
  trigger: HTMLButtonElement
  /** The list element, with `role="menu"`. It is shown and hidden with the `hidden` attribute. */
  menu: HTMLElement
  /** The items, in order. Each is a button. */
  items: readonly HTMLButtonElement[]
  /** The index of the item that is current, or -1 when none is. Focus goes there when the menu opens. */
  currentIndex: () => number
  /** Called when the reader activates an item. The menu closes after it returns. */
  onSelect: (item: HTMLButtonElement, index: number) => void
}

/**
 * Mark one item of a radio menu as the checked one.
 *
 * @param items The menu's items, in order.
 * @param index The item to check. Every other item is unchecked.
 */
export const markCheckedItem = (items: readonly HTMLButtonElement[], index: number): void =>
  items.forEach((item, position) => item.setAttribute('aria-checked', String(position === index)))

/** Space the menu needs below the button, in pixels, before it opens upward instead. */
const PLACEMENT_MARGIN = 16

/**
 * Wire a menu button. Opens on click or on the arrow keys, and closes on `Escape`, `Tab`,
 * a click outside, or a selection.
 *
 * @returns A function that removes the listeners added to the document.
 */
export const attachMenu = (options: MenuOptions): (() => void) => {
  const { host, trigger, menu, items } = options

  const isOpen = (): boolean => !menu.hidden

  /** Close the menu. Focus returns to the button unless the reader moved on by another route. */
  const close = (settings: { returnFocus: boolean }): void => {
    menu.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    if (settings.returnFocus) trigger.focus()
  }

  /** Open the menu, opening upward when there is no room below, and focus one item. */
  const open = (index: number): void => {
    menu.hidden = false
    const room = window.innerHeight - trigger.getBoundingClientRect().bottom
    host.dataset['placement'] = room < menu.offsetHeight + PLACEMENT_MARGIN ? 'top' : 'bottom'
    trigger.setAttribute('aria-expanded', 'true')
    items[index]?.focus()
  }

  const openAtCurrent = (): void => open(Math.max(options.currentIndex(), 0))

  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.addEventListener('click', () => (isOpen() ? close({ returnFocus: true }) : openAtCurrent()))
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    open(event.key === 'ArrowDown' ? 0 : items.length - 1)
  })

  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      return close({ returnFocus: true })
    }
    if (event.key === 'Tab') return close({ returnFocus: false })
    if (!isNavigationKey(event.key)) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    items[nextItemIndex(event.key, { current, count: items.length })]?.focus()
  })

  items.forEach((item, index) =>
    item.addEventListener('click', () => {
      options.onSelect(item, index)
      close({ returnFocus: true })
    }),
  )

  const onOutsidePointer = (event: PointerEvent): void => {
    if (!isOpen() || host.contains(event.target as Node)) return
    close({ returnFocus: false })
  }
  document.addEventListener('pointerdown', onOutsidePointer)
  return () => document.removeEventListener('pointerdown', onOutsidePointer)
}
