/**
 * Failure logging system with spinner support
 */
type ConsoleLogParams = Parameters<typeof console.log>
export const failures: ConsoleLogParams[] = []
/**
 * Captures a verbose failure message to be logged into a file
 * @param a - The message to log
 */
export const failureLog = (...a: ConsoleLogParams) => {
  failures.push(a)
}
