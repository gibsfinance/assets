import { writable } from 'svelte/store'

function createThemeStore() {
  const defaultValue = false
  const initialValue = typeof window !== 'undefined' ? (localStorage.getItem('theme') === 'dark') : defaultValue

  const { subscribe, set, update } = writable(initialValue)

  return {
    subscribe,
    toggle: () => update((n) => {
      const newValue = !n
      if (typeof window !== 'undefined') {
        localStorage.setItem('theme', newValue ? 'dark' : 'light')
      }
      return newValue
    }),
    set: (value: boolean) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('theme', value ? 'dark' : 'light')
      }
      set(value)
    },
  }
}

export const isDark = createThemeStore()
