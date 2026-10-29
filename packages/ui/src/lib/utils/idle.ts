/**
 * Run a callback when the browser is idle. Falls back to a short timer
 * where `requestIdleCallback` is missing (Safari).
 *
 * @param callback - Work to run.
 * @returns A function that cancels the pending work.
 */
export function scheduleIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(callback)
    return () => cancelIdleCallback(handle)
  }
  const handle = setTimeout(callback, 1)
  return () => clearTimeout(handle)
}
