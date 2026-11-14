/**
 * The worker runs under plain Node, the way the server runs: a child process started with
 * `--import ./src/bin/register-hooks.ts`, which is what makes the extensionless imports resolve. The
 * other tests run the pool inside Vitest, which is not that loader. This one checks the production way.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

interface LoadReport {
  svgBytes: number
  outputBytes: (number | null)[]
  longestPauseMs: number
  rssMb: { before: number; after: number }
}

/**
 * The child process starts Node, the production hooks and a worker, then cleans two large files: several
 * seconds alone, and far more during the coverage run on a loaded machine, where the default 5 s limit
 * timed it out. The child's own limit (120 s, below) is the real bound, so the test waits as long.
 */
const PLAIN_NODE_RUN_TIMEOUT_MS = 120_000

describe('the sanitizer worker under plain node', () => {
  it(
    'sanitizes two large logos without holding the event loop, and reports the memory they took',
    { timeout: PLAIN_NODE_RUN_TIMEOUT_MS },
    () => {
      const hooks = fileURLToPath(new URL('../../bin/register-hooks.ts', import.meta.url))
      const script = fileURLToPath(new URL('./__testing__/pool-load-check.ts', import.meta.url))

      const run = spawnSync(process.execPath, ['--import', hooks, script], {
        encoding: 'utf8',
        timeout: PLAIN_NODE_RUN_TIMEOUT_MS,
      })

      expect(run.status, run.stderr).toBe(0)
      const report = JSON.parse(run.stdout.trim().split('\n').pop() ?? '') as LoadReport
      expect(report.outputBytes).toEqual([expect.any(Number), expect.any(Number)])
      // The sanitizer takes well over this on the main thread for a file of this size, so a pause this short
      // means it ran elsewhere. The bound is generous: a timer tick is 5 ms, and a loaded runner adds to it.
      expect(report.longestPauseMs).toBeLessThan(200)
      console.log(`plain-node report: ${JSON.stringify(report)}`)
    },
  )
})
