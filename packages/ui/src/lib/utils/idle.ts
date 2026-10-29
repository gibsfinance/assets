/**
 * Run a callback when the browser is idle. Falls back to a timer where
 * `requestIdleCallback` is missing (Safari).
 *
 * @param callback - Work to run.
 * @param options.timeoutMilliseconds - Longest wait. With the idle API, the work runs
 *   by then even if the page never goes idle. Without it, the timer waits this long;
 *   omitted, the timer fires almost at once.
 * @returns A function that cancels the pending work.
 */
export function scheduleIdle(
  callback: () => void,
  { timeoutMilliseconds }: { timeoutMilliseconds?: number } = {},
): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle =
      timeoutMilliseconds === undefined
        ? requestIdleCallback(callback)
        : requestIdleCallback(callback, { timeout: timeoutMilliseconds })
    return () => cancelIdleCallback(handle)
  }
  const handle = setTimeout(callback, timeoutMilliseconds ?? 1)
  return () => clearTimeout(handle)
}
