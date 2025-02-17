import { writable } from 'svelte/store'

function createThemeStore() {
  const { subscribe, set, update } = writable(false)

  return {
    subscribe,
    toggle: () => update((n) => !n),
    set: (value: boolean) => set(value),
  }
}

export const isDark = createThemeStore()
