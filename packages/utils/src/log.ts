/**
 * Failure logging system with spinner support
 */
type ConsoleLogParams = Parameters<typeof console.log>
export const failures: ConsoleLogParams[] = []
export const failureLog = (...a: ConsoleLogParams) => {
  failures.push(a)
}
