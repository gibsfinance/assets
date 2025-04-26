import { SvelteSet, SvelteMap } from 'svelte/reactivity'
import type { Token } from '../types'

export const enabledLists = new SvelteSet<string>()
export const tokensByList = new SvelteMap<string, Token[]>()
