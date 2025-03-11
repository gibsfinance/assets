import { writable } from 'svelte/store'

// Initialize from localStorage if available
const storedShowTestnets = typeof window !== 'undefined' ? localStorage.getItem('showTestnets') === 'true' : false

// Create a writable store with the initial value
export const showTestnets = writable(storedShowTestnets)

// Subscribe to changes and update localStorage
if (typeof window !== 'undefined') {
  showTestnets.subscribe((value) => {
    localStorage.setItem('showTestnets', value.toString())
  })
}
