/** A function whose calls are delayed, with a way to drop the pending call. */
export interface Debounced<Arguments extends unknown[]> {
  (...args: Arguments): void
  /** Drop the pending call, if there is one. */
  cancel: () => void
}

/**
 * Delay a function until calls stop arriving.
 *
 * Each call restarts the wait. Only the last call in a burst runs, with its own
 * arguments, once `waitMilliseconds` pass without another call. This replaces the
 * one lodash function the interface used, which kept 70 kB of lodash in the bundle.
 *
 * @param callback - The function to delay.
 * @param waitMilliseconds - How long calls must pause before the callback runs.
 * @returns The delayed function. Call `cancel` on it to drop the pending call.
 */
export function debounce<Arguments extends unknown[]>(
  callback: (...args: Arguments) => void,
  waitMilliseconds: number,
): Debounced<Arguments> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  const cancel = () => {
    clearTimeout(timeout)
    timeout = undefined
  }

  const debounced = (...args: Arguments) => {
    cancel()
    timeout = setTimeout(() => {
      timeout = undefined
      callback(...args)
    }, waitMilliseconds)
  }

  return Object.assign(debounced, { cancel })
}
