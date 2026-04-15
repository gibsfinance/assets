const DEFAULT_PROVIDERS = [
  'coingecko',
  'uniswap',
  'trustwallet',
  'smoldapp',
  'pulsechain',
  'pulsex',
  'balancer',
  'internetmoney',
] as const

export type DefaultProvider = (typeof DEFAULT_PROVIDERS)[number]

/** Returns true if the given order matches the default provider order. */
export function isDefaultOrder(order: string[]): boolean {
  return order.length === DEFAULT_PROVIDERS.length && order.every((p, i) => p === DEFAULT_PROVIDERS[i])
}

/** Reorder an array by moving an item from one index to another. */
export function reorderArray<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...items]
  const [moved] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, moved)
  return result
}

export { DEFAULT_PROVIDERS }
