export type Timeout = {
  timeoutId: () => NodeJS.Timeout
  promise: Promise<unknown>
}

export const timeout = (ms: number) => {
  let timeoutId: NodeJS.Timeout
  const p = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, ms)
  })
  return {
    timeoutId: () => timeoutId,
    promise: p,
    clear: () => clearTimeout(timeoutId),
  }
}
