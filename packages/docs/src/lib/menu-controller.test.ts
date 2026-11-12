// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachMenu, markCheckedItem } from './menu-controller.ts'

describe('markCheckedItem', () => {
  it('checks one item and unchecks the rest', () => {
    const items = [document.createElement('button'), document.createElement('button')]
    markCheckedItem(items, 1)
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    markCheckedItem(items, 0)
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false'])
  })
})

/** The element a selector matches. The fixture always has it, and a missing one fails the test that uses it. */
const find = <T extends Element>(selector: string): T => document.querySelector<T>(selector) as T

const key = (target: Element, name: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('attachMenu', () => {
  let host: HTMLElement
  let trigger: HTMLButtonElement
  let menu: HTMLElement
  let items: HTMLButtonElement[]
  let current: number
  let selected: number[]
  let detach: () => void

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="host">
        <button class="trigger" type="button">open</button>
        <div class="menu" role="menu" hidden>
          <button type="button" role="menuitemradio">a</button>
          <button type="button" role="menuitemradio">b</button>
          <button type="button" role="menuitemradio">c</button>
        </div>
      </div>
      <button id="elsewhere" type="button">elsewhere</button>`
    host = find<HTMLElement>('#host')
    trigger = find<HTMLButtonElement>('.trigger')
    menu = find<HTMLElement>('.menu')
    items = [...menu.querySelectorAll('button')]
    current = 1
    selected = []
    detach = attachMenu({
      host,
      trigger,
      menu,
      items,
      currentIndex: () => current,
      onSelect: (_item, index) => selected.push(index),
    })
  })
  afterEach(() => {
    detach()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('starts closed and declares itself a menu button', () => {
    expect(menu.hidden).toBe(true)
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on click and puts focus on the current item', () => {
    trigger.click()
    expect(menu.hidden).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(items[1])
  })

  it('focuses the first item when none is current', () => {
    current = -1
    trigger.click()
    expect(document.activeElement).toBe(items[0])
  })

  it('closes on a second click of the button, with focus on the button', () => {
    trigger.click()
    trigger.click()
    expect(menu.hidden).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('opens on ArrowDown at the first item and on ArrowUp at the last', () => {
    expect(key(trigger, 'ArrowDown').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(items[0])
    menu.hidden = true
    key(trigger, 'ArrowUp')
    expect(document.activeElement).toBe(items[2])
  })

  it('ignores other keys on the button', () => {
    expect(key(trigger, 'a').defaultPrevented).toBe(false)
    expect(menu.hidden).toBe(true)
  })

  it('moves with the arrow keys, wraps, and jumps with Home and End', () => {
    trigger.click()
    key(items[1], 'ArrowDown')
    expect(document.activeElement).toBe(items[2])
    key(items[2], 'ArrowDown')
    expect(document.activeElement).toBe(items[0])
    key(items[0], 'ArrowUp')
    expect(document.activeElement).toBe(items[2])
    key(items[2], 'Home')
    expect(document.activeElement).toBe(items[0])
    key(items[0], 'End')
    expect(document.activeElement).toBe(items[2])
  })

  it('ignores keys that are not navigation keys', () => {
    trigger.click()
    expect(key(items[1], 'x').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(items[1])
  })

  it('closes on Escape and returns focus to the button', () => {
    trigger.click()
    key(items[1], 'Escape')
    expect(menu.hidden).toBe(true)
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on Tab without taking focus', () => {
    trigger.click()
    key(items[1], 'Tab')
    expect(menu.hidden).toBe(true)
    expect(document.activeElement).not.toBe(trigger)
  })

  it('reports a selection, closes, and returns focus', () => {
    trigger.click()
    items[2]?.click()
    expect(selected).toEqual([2])
    expect(menu.hidden).toBe(true)
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on a press outside, and stays open for a press inside', () => {
    trigger.click()
    items[0]?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu.hidden).toBe(false)
    find('#elsewhere').dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu.hidden).toBe(true)
  })

  it('ignores a press outside while closed', () => {
    find('#elsewhere').dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu.hidden).toBe(true)
  })

  it('opens downward when there is room and upward when there is not', () => {
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ bottom: 100 } as DOMRect)
    trigger.click()
    expect(host.dataset['placement']).toBe('bottom')
    trigger.click()
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ bottom: window.innerHeight } as DOMRect)
    trigger.click()
    expect(host.dataset['placement']).toBe('top')
  })

  it('stops listening to the document when detached', () => {
    trigger.click()
    detach()
    find('#elsewhere').dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu.hidden).toBe(false)
  })
})
