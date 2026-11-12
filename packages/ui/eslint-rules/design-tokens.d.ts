import type { Rule } from 'eslint'

export const PALETTE_HUES: string[]
export const MODE_WORDS: string[]
export function findRawPaletteClasses(text: string): string[]
export function explainBadTokenName(name: string): string | null
export function findBadTokenNames(css: string): { name: string; reason: string }[]
export function rawPaletteMessage(className: string): string
export const noRawPaletteClasses: Rule.RuleModule
declare const plugin: { rules: { 'no-raw-palette-classes': Rule.RuleModule } }
export default plugin
